import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'

/**
 * Retrieves the S3 bucket name by first checking the outputs of the bucket stack,
 * then the parameters of the EC2 stack.
 * @param cf CloudFormation client
 * @param bucketStackName Name of the S3 bucket CloudFormation stack
 * @param ec2StackName Name of the EC2 instance CloudFormation stack
 * @returns The bucket name if found, otherwise undefined.
 */
export async function getBucketName(
	cf: CloudFormationClient,
	bucketStackName: string,
	ec2StackName: string
): Promise<string | undefined> {
	let bucketName: string | undefined

	// Try to get BucketName from the bucket stack's outputs first
	try {
		const bucketStackDescription = await cf.send(new DescribeStacksCommand({ StackName: bucketStackName }))
		if (bucketStackDescription.Stacks && bucketStackDescription.Stacks.length > 0 && bucketStackDescription.Stacks[0].Outputs) {
			bucketName = bucketStackDescription.Stacks[0].Outputs.find(o => o.OutputKey === 'BucketName')?.OutputValue
		}
	} catch (e: any) {
		if (e.name !== 'ValidationError') { // ValidationError often means stack not found
			console.warn(`Warning: Could not describe bucket stack '${bucketStackName}' or find 'BucketName' output: ${e.message}. Will try EC2 stack parameters.`)
		} else {
			// Don't log if it's just a validation error (stack not found is common if only EC2 stack exists or neither)
		}
	}

	// If not found, try to get BucketName from EC2 stack's parameters
	if (!bucketName) {
		try {
			const ec2StackDescription = await cf.send(new DescribeStacksCommand({ StackName: ec2StackName }))
			if (ec2StackDescription.Stacks && ec2StackDescription.Stacks.length > 0 && ec2StackDescription.Stacks[0].Parameters) {
				bucketName = ec2StackDescription.Stacks[0].Parameters.find(p => p.ParameterKey === 'BucketName')?.ParameterValue
			}
		} catch (e: any) {
			// Don't log if it's just a validation error
			if (e.name !== 'ValidationError') {
				console.warn(`Warning: Could not describe EC2 stack '${ec2StackName}' or find 'BucketName' parameter: ${e.message}.`)
			}
		}
	}

	return bucketName
}

const DEFAULT_POLL_INTERVAL_MS = 30000 // 30 seconds
const DEFAULT_POLL_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Waits for a signal file to appear in S3.
 * @param s3 S3 client
 * @param bucketName Name of the S3 bucket
 * @param signalKey Key of the signal file (e.g., 'job/out/_FINISHED')
 * @param pollIntervalMs How often to poll (milliseconds)
 * @param timeoutMs Total time to wait before giving up (milliseconds)
 * @returns True if the signal file is found, false if timeout occurs.
 */
export async function waitForCompletion(
	s3: S3Client,
	bucketName: string,
	signalKey: string,
	pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
	timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS
): Promise<boolean> {
	const startTime = Date.now()
	console.log(`Waiting for signal file s3://${bucketName}/${signalKey} ... (timeout: ${timeoutMs / 1000 / 60} minutes)`)

	while (Date.now() - startTime < timeoutMs) {
		try {
			await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: signalKey }))
			process.stdout.write('\n') // Newline after progress dots
			console.log(`Signal file s3://${bucketName}/${signalKey} found.`)
			return true
		} catch (error: any) {
			if (error.name === 'NotFound') {
				// File not found yet, continue polling
				process.stdout.write('.') // Progress indicator
			} else {
				// Other error, log it and stop polling
				process.stdout.write('\n') // Newline after progress dots
				console.error(`Error checking for signal file s3://${bucketName}/${signalKey}:`, error)
				return false
			}
		}
		await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
	}

	process.stdout.write('\n') // Newline after progress dots if timeout occurs
	console.log(`Timeout waiting for signal file s3://${bucketName}/${signalKey}.`)
	return false
}
