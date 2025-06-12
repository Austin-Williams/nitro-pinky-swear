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
import { CloudFormationClient } from '@aws-sdk/client-cloudformation'
import { S3Client } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { orchestrateCreate, verifyInputPaths } from './infra/create'
import { deleteStacks } from './infra/delete'
import { handleDownload } from './infra/download'
import { showHelp } from './infra/help'
import { checkStacks } from './infra/check'
import { sessionConnect } from './infra/session'

async function run() {
	const region = process.env.AWS_REGION || 'us-east-1'
	const instanceTypeEnv = process.env.AWS_INSTANCE_TYPE || 'm8g.xlarge'
	const cf = new CloudFormationClient({ region })
	const s3 = new S3Client({ region })
	const ec2Template = readFileSync(new URL('./ec2-template.yaml', import.meta.url), 'utf8')
	const bucketTemplate = readFileSync(new URL('./bucket-template.yaml', import.meta.url), 'utf8')

	const bucketStackName = 'job-bucket-stack'
	const ec2StackName = 'job-ec2-stack'

	const createFlag = process.argv.includes('--create')
	const checkFlag = process.argv.includes('--check')
	const deleteFlag = process.argv.includes('--delete')
	const sessionFlag = process.argv.includes('--session')
	const helpFlag = process.argv.includes('--help')
	const downloadFlag = process.argv.includes('--download')
	const waitFlag = process.argv.includes('--wait')
	const yesFlag = process.argv.includes('--yes')
	const runJobFlag = process.argv.includes('--run-job')
	let waitTimeoutMs: number | undefined = undefined

	// ----------------
	// Argument parsing
	// ----------------
	const allowedFlags = new Set([
		'--create',
		'--check',
		'--delete',
		'--session',
		'--help',
		'--file',
		'--files',
		'--script',
		'--download',
		'--wait',
		'--yes',
		'--run-job',
		'--output',
	])

	const fileArgs: string[] = []
	let scriptPath: string | undefined
	let downloadPath: string = 'out/' // For standalone --download, default to 'out/'
	let outputPathForRunJob: string = 'out/' // For --run-job's download step, default to 'out/'

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
			} else if (token === '--download') {
				if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
					console.error('Error: --download flag expects a local directory path argument.')
					process.exit(1)
				}
				downloadPath = argv[i + 1]
				i++
			} else if (token === '--output') {
				const outputIndex = i // Current index is where --output is found
				if (argv.length <= outputIndex + 1 || (argv[outputIndex + 1] && argv[outputIndex + 1].startsWith('--'))) {
					// --output was given but no value, or next arg is another flag. Default 'out/' is already set for outputPathForRunJob.
				} else {
					outputPathForRunJob = argv[outputIndex + 1]
					i++
				}
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
	const activeFlags = [createFlag, checkFlag, deleteFlag, sessionFlag, downloadFlag, runJobFlag].filter(f => f).length
	if (activeFlags > 1) {
		console.error("Error: flags --create, --check, --delete, --session, --download, and --run-job are mutually exclusive. Please specify only one.")
		process.exit(1)
	}

	if (helpFlag || (activeFlags === 0 && !argv.some(arg => allowedFlags.has(arg) && arg !== '--help'))) {
		showHelp()
	}

	if (yesFlag && !deleteFlag) {
		console.error("Error: --yes flag can only be used with --delete.")
		showHelp()
	}

	if (checkFlag) {
		await checkStacks(cf)
	}

	if (sessionFlag) {
		await sessionConnect(cf, ec2StackName)
	}

	if (deleteFlag) {
		await deleteStacks(cf, bucketStackName, ec2StackName, yesFlag)
	}

	if (runJobFlag) {
		if (!scriptPath) {
			console.error("Error: --script <path> is required when using --run-job.")
			showHelp()
		}
	}

	if (createFlag) {
		// Pre-flight: ensure provided paths exist (before deploying any stacks)
		verifyInputPaths(fileArgs, scriptPath)

		await orchestrateCreate(cf, s3, { // Pass s3 client and wait options
			ec2Template,
			bucketTemplate,
			bucketStackName,
			ec2StackName,
			fileArgs,
			scriptPath,
			instanceType: instanceTypeEnv,
			waitForCompletionSignal: waitFlag,
			waitTimeoutMs: waitTimeoutMs,
		})
	}

	if (runJobFlag) {
		// Script and file args already validated above for runJobFlag
		console.log("Starting job run: This will create infrastructure, execute your script, wait for completion, download any artifacts, and then delete the infrastructure.")
		try {
			console.log("Step 1/3: Creating infrastructure and waiting for job completion...")

			// Pre-flight: ensure provided paths exist (before deploying any stacks)
			verifyInputPaths(fileArgs, scriptPath)

			await orchestrateCreate(cf, s3, { // Pass s3 client and wait options
				ec2Template,
				bucketTemplate,
				bucketStackName,
				ec2StackName,
				fileArgs,
				scriptPath,
				instanceType: instanceTypeEnv,
				waitForCompletionSignal: true,
				waitTimeoutMs: waitTimeoutMs,
			})

			console.log("Step 2/3: Downloading artifacts...")
			await handleDownload(cf, s3, bucketStackName, ec2StackName, outputPathForRunJob)

			console.log("Step 3/3: Deleting infrastructure...")
			await deleteStacks(cf, bucketStackName, ec2StackName, true)
		} catch (e) {
			console.error("Error during job run:", e)
			process.exit(1)
		}
	}

	if (downloadFlag) {
		const downloadPathIndex = process.argv.indexOf('--download') + 1
		let downloadPath = 'out/' // Default path

		if (process.argv.length > downloadPathIndex &&
			typeof process.argv[downloadPathIndex] === 'string' &&
			!process.argv[downloadPathIndex].startsWith('--')) {
			downloadPath = process.argv[downloadPathIndex]
		}

		await handleDownload(cf, s3, bucketStackName, ec2StackName, downloadPath)
		process.exit(0)
	}

	// Argument parsing for --wait [timeoutMinutes]
	if (waitFlag) {
		const waitIndex = process.argv.indexOf('--wait')
		const nextArg = process.argv[waitIndex + 1]
		if (nextArg && !nextArg.startsWith('--')) {
			const parsedTimeoutMinutes = parseInt(nextArg, 10)
			if (!isNaN(parsedTimeoutMinutes) && parsedTimeoutMinutes > 0) {
				waitTimeoutMs = parsedTimeoutMinutes * 60 * 1000 // Convert minutes to milliseconds
			} else {
				console.error(`Error: Invalid timeout value '${nextArg}' for --wait. Must be a positive number of minutes.`)
				showHelp()
			}
		}
		// If no value is provided after --wait, waitTimeoutMs remains undefined, and waitForCompletion will use its default.
	}

	if (waitFlag && !createFlag && !runJobFlag) {
		console.error("Error: --wait flag can only be used with --create or --run-job.")
		showHelp()
	}
}

run().catch((e) => {
	console.error(e)
	process.exit(1)
})
