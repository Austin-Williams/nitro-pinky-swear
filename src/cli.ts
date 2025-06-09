#!/usr/bin/env ts-node
import 'dotenv/config'
import { Command } from 'commander'
import { spawn } from 'child_process'
import path from 'path'
import { statSync } from 'fs'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'

const program = new Command()
program
	.name('nitro-pinky-swear')
	.description('Trusted-setup in an AWS Nitro Enclave')
	.version('0.1.0')

program
	.command('setup')
	.requiredOption('--circom <file>', 'path to your .circom file')
	.action(async ({ circom }) => {
		// 1) Estimate memory (GiB) based on file size
		const sizeMB = statSync(circom).size / (1024 ** 2)
		const opts = [8, 16, 32, 64, 128]
		const requiredRam = opts.find(n => n >= Math.ceil(sizeMB * 2)) || 128

		// 2) Generate a bucket name from the circom basename + timestamp
		const base = path.basename(circom, path.extname(circom))
		const bucket = `${base}-${Date.now()}`
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '')

		// 3) Get AMI ID (env override or SSM lookup)
		let amiId = process.env.AMI_ID
		if (!amiId) {
			console.log('Fetching latest Amazon Linux 2 AMI ID…')
			const ssm = new SSMClient({ region: process.env.AWS_REGION })
			const { Parameter } = await ssm.send(new GetParameterCommand({
				Name: '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2'
			}))
			amiId = Parameter!.Value!
			console.log(`Using AMI ID ${amiId}`)
		}

		// 4) Spawn the infra driver
		const driver = path.resolve(__dirname, 'aws/infra/driver.ts')
		console.log(`Running driver: npx --no-install tsx ${driver} ${requiredRam} ${bucket} ${amiId}`)
		const child = spawn('npx', ['--no-install', 'tsx', driver, `${requiredRam}`, bucket, amiId], {
			stdio: 'inherit'
		})
		child.on('exit', code => process.exit(code ?? 0))
	})

program.parse()