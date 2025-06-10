import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation"
import { spawn } from "child_process"

export async function sessionConnect(cf: CloudFormationClient, stackName: string) {
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