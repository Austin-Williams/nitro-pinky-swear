#!/usr/bin/env ts-node
/**
 * infra.ts - Infrastructure manager for creating, checking, and deleting CloudFormation stacks.
 *
 * AWS Credentials (for .env file) & Required Permissions
 * -------------------------------------------------------
 * This script uses your local AWS credentials supplied via environment variables
 * (e.g., in a .env file loaded with `dotenv`):
 *
 *   AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
 *   AWS_SESSION_TOKEN=YOUR_SESSION_TOKEN # if using temporary creds
 *   AWS_REGION=us-east-1 # optional, defaults to us-east-1
 *   AWS_INSTANCE_TYPE=m8g.xlarge # optional, defaults to m8g.xlarge	
 *
 * These credentials must belong to an IAM user or role that has permission to:
 *
 * 1) Manage CloudFormation stacks:
 *    - cloudformation:CreateStack
 *    - cloudformation:DeleteStack
 *    - cloudformation:DescribeStacks
 *    - cloudformation:DescribeStackEvents
 *    (You can attach the AWS managed policy 'CloudFormationFullAccess' or
 *     define a custom policy with just these actions.)
 *
 * 2) Read from the S3 bucket where job results are stored:
 *    - s3:ListBucket
 *    - s3:GetObject
 *    (You can attach the AWS managed policy 'AmazonS3ReadOnlyAccess' or
 *     define a custom policy scoped to your bucket path.)
 * 
 * 3) (Optional) SSM access for debugging and development
 * 		- ssm:SendCommand
 * 		- ssm:GetCommandInvocation
 * 		- ssm:StartSession
 * 		- ssm:DescribeInstanceInformation
 * 		- ssm:DescribeSessions
 * 		(You can attach the AWS managed policy 'AmazonSSMFullAccess' or
 * 		define a custom policy with just these actions.)
 *
 * All other resources (EC2 instance roles, SSM instance profile, S3 bucket,
 * etc.) are created and deleted by the CloudFormation template at runtime.
 *
 * For development environments, using static IAM user credentials in a .env
 * file is acceptable for this standalone tool. Be sure to follow least-privilege
 * and rotate credentials regularly.
 */
import 'dotenv/config'
import { CloudFormationClient, CreateStackCommand, DeleteStackCommand, DescribeStacksCommand, waitUntilStackCreateComplete, waitUntilStackDeleteComplete } from '@aws-sdk/client-cloudformation'
import { readFileSync, existsSync } from 'fs'
import * as readline from 'readline'
import { spawn } from 'child_process'
import path from 'path'

async function run() {
	const region = process.env.AWS_REGION || 'us-east-1'
	const instanceTypeEnv = process.env.AWS_INSTANCE_TYPE || 'm8g.xlarge'
	const cf = new CloudFormationClient({ region })
	const ec2Template = readFileSync(new URL('./ec2-template.yaml', import.meta.url), 'utf8')
	const bucketTemplate = readFileSync(new URL('./bucket-template.yaml', import.meta.url), 'utf8')

	const bucketStackName = 'job-bucket-stack'
	const ec2StackName = 'job-ec2-stack'

	const createFlag = process.argv.includes('--create')
	const checkFlag = process.argv.includes('--check')
	const deleteFlag = process.argv.includes('--delete')
	const sessionFlag = process.argv.includes('--session')
	const helpFlag = process.argv.includes('--help')

	// ------------------------------------------------------------------
	// Argument parsing
	// ------------------------------------------------------------------
	const allowedFlags = new Set([
		'--create',
		'--check',
		'--delete',
		'--session',
		'--help',
		'--file',
		'--files',
		'--script',
	])

	const fileArgs: string[] = []
	let scriptPath: string | undefined

	const argv = process.argv.slice(2)
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]
		if (allowedFlags.has(token)) {
			if (token === '--file' || token === '--files') {
				if (!argv[i + 1]) {
					console.error(`Error: ${token} flag expects a path argument.`)
					process.exit(1)
				}
				fileArgs.push(argv[i + 1])
				i++
			} else if (token === '--script') {
				if (!argv[i + 1]) {
					console.error('Error: --script flag expects a path argument.')
					process.exit(1)
				}
				scriptPath = argv[i + 1]
				i++
			}
			// other flags don't need value processing here
		} else if (token.startsWith('-')) {
			console.error(`Error: Unknown option '${token}'.`)
			process.exit(1)
		} else {
			// positional argument → user probably forgot --file
			console.error(`Error: Unrecognized positional argument '${token}'. Did you forget to prefix it with --file ?`)
			process.exit(1)
		}
	}

	// Mutual exclusivity
	const activeFlags = [createFlag, checkFlag, deleteFlag, sessionFlag].filter(f => f).length
	if (activeFlags > 1) {
		console.error("Error: flags --create, --check, --delete, and --session are mutually exclusive. Please specify only one.")
		process.exit(1)
	}

	if (helpFlag || activeFlags === 0) {
		showHelp()
	}

	if (checkFlag) {
		await checkStacks(cf)
	}

	if (sessionFlag) {
		await sessionConnect(cf, ec2StackName)
	}

	if (deleteFlag) {
		await deleteStacks(cf, bucketStackName, ec2StackName)
	}

	if (createFlag) {
		// Pre-flight: ensure provided paths exist (before deploying any stacks)
		verifyInputPaths(fileArgs, scriptPath)

		await orchestrateCreate(cf, {
			ec2Template,
			bucketTemplate,
			bucketStackName,
			ec2StackName,
			fileArgs,
			scriptPath,
			instanceType: instanceTypeEnv,
		})
	}
}

async function deleteStacks(cf: CloudFormationClient, bucketStackName: string, ec2StackName: string) {
	// Describe both stacks to determine existence
	let ec2Exists = false
	let bucketExists = false
	try {
		await cf.send(new DescribeStacksCommand({ StackName: ec2StackName }))
		ec2Exists = true
	} catch { }
	try {
		await cf.send(new DescribeStacksCommand({ StackName: bucketStackName }))
		bucketExists = true
	} catch { }

	if (!ec2Exists && !bucketExists) {
		console.log('No related CloudFormation stacks found to delete.')
		return
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	const answer = await new Promise<string>(res => rl.question(`Delete EC2 stack '${ec2StackName}'${bucketExists ? ` and bucket stack '${bucketStackName}'` : ''}? [y/N] `, ans => { rl.close(); res(ans) }))
	if (answer.toLowerCase() !== 'y') {
		console.log('Aborted delete.')
		return
	}

	// First delete EC2 stack if present (so bucket can be emptied safely afterward)
	await deleteStackSafe(cf, ec2StackName)
	// Then empty bucket and delete bucket stack
	await deleteBucketStackSafe(cf, bucketStackName)
}

async function deleteStackSafe(cf: CloudFormationClient, stackName: string) {
	try {
		const resp = await cf.send(new DescribeStacksCommand({ StackName: stackName }))
		if (!resp.Stacks || resp.Stacks.length === 0) {
			console.log(`No stack '${stackName}' found. Skipping.`)
			return
		}
		console.log(`Deleting stack '${stackName}'...`)
		await cf.send(new DeleteStackCommand({ StackName: stackName }))
		await waitUntilStackDeleteComplete({ client: cf, maxWaitTime: 600 }, { StackName: stackName })
		console.log(`Stack '${stackName}' deleted.`)
	} catch (err: any) {
		if (err.name === 'ValidationError') {
			console.log(`No stack '${stackName}' found. Skipping.`)
			return
		}
		console.error(`Error deleting stack '${stackName}':`, err)
		process.exit(1)
	}
}

async function deleteBucketStackSafe(cf: CloudFormationClient, stackName: string) {
	try {
		const resp = await cf.send(new DescribeStacksCommand({ StackName: stackName }))
		if (!resp.Stacks || resp.Stacks.length === 0) {
			console.log(`No bucket stack '${stackName}' found.`)
			return
		}
		const bucketName = resp.Stacks[0].Outputs?.find(o => o.OutputKey === 'BucketName')?.OutputValue
		if (bucketName) {
			console.log(`Emptying bucket '${bucketName}'...`)
			await new Promise<void>((resolve, reject) => {
				const rm = spawn('aws', ['s3', 'rm', `s3://${bucketName}`, '--recursive'], { stdio: 'inherit' })
				rm.on('error', reject)
				rm.on('close', code => code === 0 ? resolve() : reject(new Error(`Bucket cleanup failed with code ${code}`)))
			})
		}
		console.log(`Deleting bucket stack '${stackName}'...`)
		await cf.send(new DeleteStackCommand({ StackName: stackName }))
		await waitUntilStackDeleteComplete({ client: cf, maxWaitTime: 600 }, { StackName: stackName })
		console.log(`Bucket stack deleted.`)
	} catch (err: any) {
		if (err.name === 'ValidationError') {
			console.log(`No bucket stack '${stackName}' found.`)
			return
		}
		console.error(`Error deleting bucket stack '${stackName}':`, err)
		process.exit(1)
	}
}

// -- Helper functions for each CLI option
function showHelp() {
	console.log(`Usage: infra.ts [options]\n` +
		`  --create                Create the CloudFormation stack\n` +
		`    --file[s] <path>      Upload a file to the instance (repeatable, only with --create)\n` +
		`    --script <path>       Run a script on the instance (only with --create)\n` +
		`  --check                 List existing stacks\n` +
		`  --delete                Delete the stack\n` +
		`  --session               Open an SSM session to the instance\n` +
		`  --help                  Show this help`)
	process.exit(0)
}

async function checkStacks(cf: CloudFormationClient) {
	const resp = await cf.send(new DescribeStacksCommand({}))
	const stacks = resp.Stacks ?? []
	if (stacks.length === 0) {
		console.log('Existing CloudFormation stacks: None')
	} else {
		console.log('Existing CloudFormation stacks:')
		stacks.forEach(s => console.log(`  ${s.StackName}: ${s.StackStatus}`))
	}
	process.exit(0)
}

interface OrchestrateCreateOpts {
	ec2Template: string
	bucketTemplate: string
	bucketStackName: string
	ec2StackName: string
	fileArgs: string[]
	scriptPath?: string
	instanceType: string
}

async function orchestrateCreate(cf: CloudFormationClient, opts: OrchestrateCreateOpts) {
	const { bucketStackName, ec2StackName, bucketTemplate, ec2Template, fileArgs, scriptPath, instanceType } = opts

	// Step 1: create / ensure bucket stack exists
	let bucketName: string | undefined
	try {
		const desc = await cf.send(new DescribeStacksCommand({ StackName: bucketStackName }))
		bucketName = desc.Stacks?.[0]?.Outputs?.find(o => o.OutputKey === 'BucketName')?.OutputValue
	} catch (err: any) {
		if (err.name !== 'ValidationError') throw err
	}

	if (!bucketName) {
		console.log(`Creating bucket stack '${bucketStackName}'...`)
		await cf.send(new CreateStackCommand({
			StackName: bucketStackName,
			TemplateBody: bucketTemplate,
		}))
		await waitUntilStackCreateComplete({ client: cf, maxWaitTime: 300 }, { StackName: bucketStackName })
		const desc = await cf.send(new DescribeStacksCommand({ StackName: bucketStackName }))
		bucketName = desc.Stacks?.[0]?.Outputs?.find(o => o.OutputKey === 'BucketName')?.OutputValue
	}

	if (!bucketName) {
		console.error('Could not determine bucket name from bucket stack.')
		process.exit(1)
	}

	// Step 2: upload user files (if any)
	if (fileArgs.length > 0 || scriptPath) {
		for (const localPath of fileArgs) {
			if (!existsSync(localPath)) {
				console.error(`Error: file not found at ${localPath}`)
				process.exit(1)
			}
			const key = path.basename(localPath)
			console.log(`Uploading ${key} to s3://${bucketName}/${key}...`)
			await new Promise<void>((resolve, reject) => {
				const up = spawn('aws', ['s3', 'cp', localPath, `s3://${bucketName}/${key}`], { stdio: 'inherit' })
				up.on('error', reject)
				up.on('close', code => code === 0 ? resolve() : reject(new Error(`Upload failed with code ${code}`)))
			})
		}

		if (scriptPath) {
			if (!existsSync(scriptPath)) {
				console.error(`Error: script not found at ${scriptPath}`)
				process.exit(1)
			}
			const scriptKey = path.basename(scriptPath)
			console.log(`Uploading script ${scriptKey} to s3://${bucketName}/${scriptKey}...`)
			await new Promise<void>((resolve, reject) => {
				const up = spawn('aws', ['s3', 'cp', scriptPath, `s3://${bucketName}/${scriptKey}`], { stdio: 'inherit' })
				up.on('error', reject)
				up.on('close', code => code === 0 ? resolve() : reject(new Error(`Upload failed with code ${code}`)))
			})
		}
	}

	// Step 3: create EC2 stack. Recreate if exists? We'll fail if already exists.
	const fileKeys = fileArgs.map(p => path.basename(p))
	const scriptKeyName = scriptPath ? path.basename(scriptPath) : undefined

	await createStack(cf, ec2Template, ec2StackName, bucketName, fileKeys, scriptKeyName, instanceType)
}

function verifyInputPaths(fileArgs: string[], scriptPath?: string) {
	for (const p of fileArgs) {
		if (!existsSync(p)) {
			console.error(`Error: file not found at ${p}`)
			process.exit(1)
		}
	}
	if (scriptPath && !existsSync(scriptPath)) {
		console.error(`Error: script not found at ${scriptPath}`)
		process.exit(1)
	}
}

async function createStack(cf: CloudFormationClient, templateBody: string, stackName: string, bucketName: string, inputFiles: string[], scriptKey: string | undefined, instanceType: string) {
	try {
		console.log(`Deploying CloudFormation stack '${stackName}'. This may take a few minutes...`)
		const cfnParams: any[] = [
			{ ParameterKey: 'BucketName', ParameterValue: bucketName },
			{ ParameterKey: 'InstanceType', ParameterValue: instanceType },
		]
		if (inputFiles.length > 0) {
			cfnParams.push({ ParameterKey: 'InputFiles', ParameterValue: inputFiles.join(',') })
		}
		if (scriptKey) {
			cfnParams.push({ ParameterKey: 'ScriptKey', ParameterValue: scriptKey })
		}
		await cf.send(new CreateStackCommand({ StackName: stackName, TemplateBody: templateBody, Capabilities: ['CAPABILITY_IAM'], Parameters: cfnParams }))
		await waitUntilStackCreateComplete({ client: cf, maxWaitTime: 600 }, { StackName: stackName })
		console.log('Stack created.')
	} catch (error) {
		if ((error as any).name === 'AlreadyExistsException') {
			console.log(`Stack '${stackName}' already exists. Use --check to view status.`)
			process.exit(0)
		}
		console.error('Stack creation failed:', error)
		process.exit(1)
	}
}

async function sessionConnect(cf: CloudFormationClient, stackName: string) {
	try {
		const resp = await cf.send(new DescribeStacksCommand({ StackName: stackName }))
		const stacks = resp.Stacks ?? []
		if (stacks.length === 0) {
			console.log(`No stack '${stackName}' found.`)
			process.exit(0)
		}
		const instanceId = stacks[0].Outputs?.find(o => o.OutputKey === 'InstanceId')?.OutputValue
		if (!instanceId) {
			console.log(`InstanceId output not found. Is the stack ready?`)
			process.exit(1)
		}
		console.log(`Starting SSM session to instance ${instanceId}...`)
		const s = spawn('aws', ['ssm', 'start-session', '--target', instanceId], { stdio: 'inherit' })
		s.on('exit', (code) => process.exit(code ?? 0))
	} catch (error) {
		console.error('Error starting session:', error)
		process.exit(1)
	}
}

run().catch((e) => {
	console.error(e)
	process.exit(1)
})
