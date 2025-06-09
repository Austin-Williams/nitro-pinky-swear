import { compileCircomCircuit } from '../../src/zk/circom-compile'

const filePath = process.argv[2]
if (!filePath) {
	console.error('Usage: tsx compile-circom-circuit.ts <filePath>')
	process.exit(1)
}

async function main() {
	console.log(`Compiling "${filePath}"`)
	await compileCircomCircuit(filePath)
	console.log('Compilation complete.')
}

main().catch((err) => {
	console.error('Error:', err)
	process.exit(1)
})