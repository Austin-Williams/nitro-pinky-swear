import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation"

export async function checkStacks(cf: CloudFormationClient) {
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