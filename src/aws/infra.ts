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
import { getBucketName, waitForCompletion } from './infra/utils'

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
	])

	const fileArgs: string[] = []
	let scriptPath: string | undefined
	let downloadPath: string | undefined

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
	const activeFlags = [createFlag, checkFlag, deleteFlag, sessionFlag, downloadFlag].filter(f => f).length
	if (activeFlags > 1) {
		console.error("Error: flags --create, --check, --delete, --session, and --download are mutually exclusive. Please specify only one.")
		process.exit(1)
	}

	if (helpFlag || (activeFlags === 0 && !argv.some(arg => allowedFlags.has(arg) && arg !== '--help'))) {
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

		if (waitFlag) {
			console.log("\nCreate operation finished. Now waiting for ceremony completion signal...")
			const bucketName = await getBucketName(cf, bucketStackName, ec2StackName)
			if (bucketName) {
				const signalKey = 'job/out/_FINISHED'
				// Pass waitTimeoutMs to waitForCompletion. It will be undefined if not provided by user, 
				// in which case waitForCompletion uses its default.
				const success = await waitForCompletion(s3, bucketName, signalKey, undefined, waitTimeoutMs)
				if (success) {
					console.log("Ceremony completed successfully and artifacts should be available.")
					// Optionally, could trigger download here automatically
				} else {
					console.log("Timed out waiting for ceremony completion signal, or an error occurred.")
				}
			} else {
				console.error("Error: Could not determine S3 bucket name to wait for completion signal. Please check stack status.")
			}
		}
		process.exit(0)
	}

	if (downloadFlag) {
		const downloadPathIndex = process.argv.indexOf('--download') + 1
		const downloadPath = process.argv[downloadPathIndex]
		if (typeof downloadPath === 'string' && downloadPath.length > 0 && !downloadPath.startsWith('--')) {
			await handleDownload(cf, s3, bucketStackName, ec2StackName, downloadPath)
			process.exit(0)
		} else {
			console.error("Error: --download flag requires a local directory path argument.")
			showHelp() // showHelp calls process.exit(0)
		}
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

	if (waitFlag && !createFlag) {
		console.error("Error: --wait flag can only be used with --create.")
		showHelp()
	}
}

run().catch((e) => {
	console.error(e)
	process.exit(1)
})
