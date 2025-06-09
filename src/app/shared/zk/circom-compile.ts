import { mkdir } from 'fs/promises'
import { exec } from "child_process"
import { r1cs } from "snarkjs"
import { promisify } from "util"
import { ptauFiles } from "./ptau-file-info"
import type { PtauFileInfo } from "./ptau-file-info"
const execAsync = promisify(exec)

export async function compileCircomCircuit(filePath: string, outDir = '.'): Promise<void> {
	await mkdir(outDir, { recursive: true })
	console.log(`Compiling "${filePath}"`)
	const cmd = `circom "${filePath}" --r1cs --wasm --c --sym --inspect --output ${outDir}`
	await execAsync(cmd)
	console.log(`Compiled "${filePath}"`)
}

export async function getExpectedPtauFileInfo(r1csFilePath: string): Promise<PtauFileInfo> {
	const info = await r1cs.info(r1csFilePath)
	// snarkjs.r1cs.info returns an object with constraint counts
	const rawCount = (info as any).nConstraints ?? (info as any).constraints ?? 0
	const totalConstraints = typeof rawCount === 'bigint'
		? Number(rawCount)
		: Number(rawCount)

	let P = 1
	while ((1 << P) < totalConstraints) P++
	if (P < 8) P = 8
	if (P > 28) P = 28

	return ptauFiles[P]
}
