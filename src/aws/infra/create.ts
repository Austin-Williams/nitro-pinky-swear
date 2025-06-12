import { CloudFormationClient, CreateStackCommand, waitUntilStackCreateComplete } from "@aws-sdk/client-cloudformation"
import { S3Client } from "@aws-sdk/client-s3"
import { spawn } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { getBucketName, waitForCompletion } from "./utils"

interface OrchestrateCreateOpts {
	ec2Template: string
	bucketTemplate: string
	bucketStackName: string
	ec2StackName: string
	fileArgs: string[]
	scriptPath?: string
	instanceType: string
	waitForCompletionSignal?: boolean
	waitTimeoutMs?: number
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

async function createStack(cf: CloudFormationClient, templateBody: string, stackName: string, bucketName: string, inputFiles: string[], scriptKey: string | undefined, instanceType?: string) {
	try {
		console.log(`Deploying CloudFormation stack '${stackName}'. This may take a few minutes...`)
		const cfnParams: any[] = [
			{ ParameterKey: 'BucketName', ParameterValue: bucketName },
		]

		if (instanceType) {
			cfnParams.push({ ParameterKey: 'InstanceType', ParameterValue: instanceType })
		}

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

export async function orchestrateCreate(cf: CloudFormationClient, s3: S3Client, opts: OrchestrateCreateOpts) {
	const { ec2Template, bucketTemplate, bucketStackName, ec2StackName, fileArgs, scriptPath, instanceType, waitForCompletionSignal, waitTimeoutMs } = opts

	// 1. Create the S3 bucket stack (or use existing)
	await createStack(cf, bucketTemplate, bucketStackName, "", [], undefined, undefined)

	// 2. Get the actual bucket name from the S3 stack outputs
	const actualBucketName = await getBucketName(cf, bucketStackName, ec2StackName)
	if (!actualBucketName) {
		console.error(`Error: Could not determine bucket name from stack ${bucketStackName}. Cannot proceed with EC2 stack creation or file uploads.`)
		process.exit(1)
	}

	// 3. Upload files and script to the S3 bucket
	if (fileArgs.length > 0 || scriptPath) {
		for (const localPath of fileArgs) {
			if (!existsSync(localPath)) {
				console.error(`Error: file not found at ${localPath}`)
				process.exit(1)
			}
			const key = path.basename(localPath)
			await new Promise<void>((resolve, reject) => {
				const up = spawn('aws', ['s3', 'cp', localPath, `s3://${actualBucketName}/${key}`], { stdio: 'inherit' })
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
				const up = spawn('aws', ['s3', 'cp', scriptPath, `s3://${actualBucketName}/${scriptKey}`], { stdio: 'inherit' })
				up.on('error', reject)
				up.on('close', code => code === 0 ? resolve() : reject(new Error(`Upload failed with code ${code}`)))
			})
		}
	}

	// 4. Create EC2 stack
	const fileKeys = fileArgs.map(p => path.basename(p))
	const scriptKeyName = scriptPath ? path.basename(scriptPath) : undefined
	await createStack(cf, ec2Template, ec2StackName, actualBucketName, fileKeys, scriptKeyName, instanceType)

	// 5. Optionally wait for job completion signal from S3
	if (waitForCompletionSignal) {
		console.log('\nJob running on EC2 instance. Waiting for it to finish...')
		console.log('You can connect to the session if you want to. Just do:\nnpx --no-install tsx ./src/aws/infra.ts --session\nin a seperate terminal.\n')
		console.log('Once connected, you can do: \nsudo su - ec2 - user - c "tmux a"\nto watch your script run.\n')
		const signalKey = 'job/out/_FINISHED'
		const success = await waitForCompletion(s3, actualBucketName, signalKey, undefined, waitTimeoutMs)
		if (success) {
			console.log("Job completed successfully (detected _FINISHED signal) and artifacts should be available.")
		} else {
			console.log("Timed out waiting for job completion signal (_FINISHED), or an error occurred during polling.")
		}
	} else {
		console.log("\nEC2 stack creation finished. Not waiting for job completion signal as --wait was not specified.")
	}
}