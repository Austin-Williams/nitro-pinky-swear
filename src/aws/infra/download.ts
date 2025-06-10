import * as path from 'path'
import { CloudFormationClient } from '@aws-sdk/client-cloudformation'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { writeFile, mkdir } from 'fs/promises'

import { existsSync } from 'fs'
import { getBucketName } from './utils'

export async function handleDownload(cf: CloudFormationClient, s3: S3Client, bucketStackName: string, ec2StackName: string, localPath: string) {
	console.log(`Attempting to download artifacts to ${localPath}...`)

	try {
		const bucketName = await getBucketName(cf, bucketStackName, ec2StackName)

		if (!bucketName) {
			console.error(`Error: Could not determine S3 bucket name from CloudFormation outputs of '${bucketStackName}' or parameters of '${ec2StackName}'. Cannot download artifacts.`)
			console.log(`Please ensure either the bucket stack ('${bucketStackName}') or the EC2 stack ('${ec2StackName}') exists and has the 'BucketName' output or parameter, respectively.`)
			process.exit(1)
		}
		console.log(`Using S3 bucket: ${bucketName}`)

		// Ensure local directory exists
		try {
			await mkdir(localPath, { recursive: true })
		} catch (e: any) {
			if (e.code !== 'EEXIST') { // Ignore if directory already exists
				console.error(`Error creating local directory ${localPath}: ${e.message}`)
				process.exit(1)
			}
		}

		const s3Prefix = 'job/out/'
		console.log(`Listing objects in s3://${bucketName}/${s3Prefix}`)

		let continuationToken: string | undefined
		let filesDownloaded = 0
		let totalListedObjects = 0
		do {
			const listResponse = await s3.send(new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: s3Prefix,
				ContinuationToken: continuationToken,
			}))

			totalListedObjects += listResponse.KeyCount || 0

			if (!listResponse.Contents || listResponse.Contents.length === 0) {
				if (!continuationToken && totalListedObjects === 0) {
					console.log(`No objects found in s3://${bucketName}/${s3Prefix}`)
				}
				break
			}

			for (const item of listResponse.Contents) {
				if (!item.Key || item.Key === s3Prefix || item.Key.endsWith('/') || item.Key.endsWith('_FINISHED')) { // Skip prefix itself or "folders"
					continue
				}

				const relativeKey = item.Key.substring(s3Prefix.length)
				const localFilePath = path.join(localPath, relativeKey)
				const localFileDir = path.dirname(localFilePath)

				if (localFileDir !== localPath && !existsSync(localFileDir)) {
					await mkdir(localFileDir, { recursive: true })
				}

				console.log(`Downloading s3://${bucketName}/${item.Key} to ${localFilePath}...`)
				try {
					const getObjectResponse = await s3.send(new GetObjectCommand({
						Bucket: bucketName,
						Key: item.Key,
					}))

					if (getObjectResponse.Body instanceof Readable) {
						const chunks: Buffer[] = []
						for await (const chunk of getObjectResponse.Body) {
							chunks.push(chunk as Buffer)
						}
						await writeFile(localFilePath, Buffer.concat(chunks))
						filesDownloaded++
					} else {
						console.warn(`Warning: Could not read body of s3://${bucketName}/${item.Key}. Skipping.`)
					}
				} catch (e: any) {
					console.error(`Error downloading ${item.Key}: ${e.message}`)
				}
			}
			continuationToken = listResponse.NextContinuationToken
		} while (continuationToken)

		if (filesDownloaded > 0) {
			console.log(`\nSuccessfully downloaded ${filesDownloaded} file(s) to ${localPath}.`)
		} else if (totalListedObjects > 0 && filesDownloaded === 0) {
			console.log(`\nNo files were downloaded. ${totalListedObjects} object(s) found in s3://${bucketName}/${s3Prefix} were not downloaded (e.g. already exist, skipped, or errors).`)
		} else if (totalListedObjects === 0 && filesDownloaded === 0) {
			// "No objects found..." message is handled earlier if totalListedObjects is 0 from the start.
		}

	} catch (err: any) {
		console.error(`Failed to download artifacts: ${err.message}`)
		if (err.stack) {
			console.error(err.stack)
		}
		process.exit(1)
	}
}