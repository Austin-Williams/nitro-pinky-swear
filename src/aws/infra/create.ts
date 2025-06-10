import { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, waitUntilStackCreateComplete } from "@aws-sdk/client-cloudformation"
import { spawn } from "child_process"
import { existsSync } from "fs"
import path from "path"


interface OrchestrateCreateOpts {
	ec2Template: string
	bucketTemplate: string
	bucketStackName: string
	ec2StackName: string
	fileArgs: string[]
	scriptPath?: string
	instanceType: string
}

export function verifyInputPaths(fileArgs: string[], scriptPath?: string) {
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
		console.log('Cloud infrastructure deployed successfully.')
	} catch (error) {
		if ((error as any).name === 'AlreadyExistsException') {
			console.log(`Stack '${stackName}' already exists. Use --check to view status.`)
			process.exit(0)
		}
		console.error('Stack creation failed:', error)
		process.exit(1)
	}
}

export async function orchestrateCreate(cf: CloudFormationClient, opts: OrchestrateCreateOpts) {
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