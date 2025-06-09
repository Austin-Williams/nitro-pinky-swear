import * as fs from 'fs'

export function sanityCheckHardwareRng(): void {
	const rngPath = '/sys/devices/virtual/misc/hw_random/rng_current'
	const current = fs.readFileSync(rngPath, 'utf8').trim()
	if (current !== 'nsm-hwrng') {
		throw new Error(`[Enclave] Expected hardware RNG “nsm-hwrng”, got “${current}”. Abort.`)
	}
	console.log('[Enclave] Hardware RNG sanity check passed. Using nsm-hwrng\n')
}