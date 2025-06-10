import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand, waitUntilStackDeleteComplete } from "@aws-sdk/client-cloudformation"
import { spawn } from "child_process"
import * as readline from 'readline'

export async function deleteStacks(cf: CloudFormationClient, bucketStackName: string, ec2StackName: string, yesFlag?: boolean) {
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

	if (!yesFlag) {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
		const answer = await new Promise<string>(res => rl.question(`Delete EC2 stack '${ec2StackName}'${bucketExists ? ` and bucket stack '${bucketStackName}'` : ''}? [y/N] `, ans => { rl.close(); res(ans) }))
		if (answer.toLowerCase() !== 'y') {
			console.log('Aborted delete.')
			return
		}
	} else {
		console.log("Proceeding with deletion due to --yes flag.")
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