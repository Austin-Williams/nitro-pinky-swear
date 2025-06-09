### Phase-2 on a **r8g.24xlarge** (96 vCPU parent, 64-vCPU / 512 GiB enclave)

Assumes we do the `zkey new` outside the enclave (which is safe), and the contribution, beacon, and final `zkey verify` inside the enclave (which is auditable).


| k  | `.ptau` size (GiB) | **Peak enclave RAM** (GiB) ✦ | **Peak host RAM** (GiB) † | **Wall-clock** (min) ‡ | **EC2 \$** § |
| -- | ------------------ | ---------------------------- | ------------------------- | ---------------------- | ------------ |
| 18 | 0.28               | 0.7                          | 1.4                       | **≈ 6 min**            | **\$0.60**   |
| 19 | 0.56               | 1.5                          | 2.8                       | 8 min                  | \$0.77       |
| 20 | 1.13               | 2.9                          | 5.6                       | 12 min                 | \$1.11       |
| 21 | 2.25               | 5.9                          | 11.3                      | 19 min                 | \$1.79       |
| 22 | 4.50               | 11.7                         | 22.5                      | 33 min                 | \$3.14       |
| 23 | 9.00               | 23.4                         | 45.0                      | 62 min                 | \$5.85       |
| 24 | 18.0               | 46.8                         | 90.0                      | 120 min                | \$11.27      |
| 25 | 36.0               | 93.6                         | 180                       | 234 min (≈ 3 h 54 m)   | \$22.11      |
| 26 | 72.0               | 187                          | 360                       | 464 min (≈ 7 h 44 m)   | \$43.79      |
| 27 | 144                | 374                          | 720                       | 924 min (≈ 15 h 24 m)  | \$87.15      |
| 28 | 288                | **> 512**                    | 1 440                     | —                      | —            |

✦ 2.5 × |`0000.zkey`| during contribution dominates; still < 512 GiB for k ≤ 27.
† `zkey new` outside the enclave peaks at ≈ 5 × |`.ptau`| in RAM. Host’s 768 GiB is enough up to k = 27.
‡ Includes: spin-up (3 m) + S3 download + `zkey new` (≈ 4 min / GiB) + contribute (1.3 min / GiB) + 1.5 m beacon wait + verify inside enclave (≈ 1 min / GiB) + S3 upload.
§ On-demand `r8g.24xlarge` us-east-1 price = **\$5.66 / h** ⇒ \$0.0943 / min.

---

### Approximate ceremony budget on **`r8g.16xlarge`**

(64 vCPU parent ⇒ 62-core enclave, 512 GiB max enclave RAM, 512 GiB host RAM)
*The final verify runs **inside the enclave**, so users need only the attested hash of `final.zkey`.*

| k  | `.ptau` size<br>(GiB) | **Peak enclave RAM**<br>(GiB) ✦ | **Peak host RAM**<br>(GiB) † | **Wall-clock**<br>(min) ‡ | **EC2 cost**<br>(USD) § |
| -- | --------------------- | ------------------------------- | ---------------------------- | ------------------------- | ----------------------- | 
| 18 | 0.28                  | 0.7                             | 1.4                          | **≈ 6**                   | **\$0.38**              | 
| 19 | 0.56                  | 1.4                             | 2.8                          | 8                         | \$0.48                  | 
| 20 | 1.13                  | 2.8                             | 5.6                          | 11                        | \$0.67                  | 
| 21 | 2.25                  | 5.6                             | 11.3                         | 17                        | \$1.06                  | 
| 22 | 4.50                  | 11.3                            | 22.5                         | 29                        | \$1.84                  | 
| 23 | 9.0                   | 22.5                            | 45.0                         | 54                        | \$3.39                  | 
| 24 | 18                    | 45                              | 90                           | 104                       | \$6.50                  | 
| 25 | 36                    | 90                              | 180                          | 203                       | \$12.7                  | 
| 26 | 72                    | 180                             | 360                          | 401                       | \$25.2                  | 
| 27 | 144                   | 360                             | **720**                      | **≈ 797**                 | **\$50.0**              | 

✦ 2.5 × `0000.zkey` during contribution (verify adds ≈ 1 × size).
† `zkey new` outside the enclave peaks at ≈ 5 × `.ptau` size; host memory is 512 GiB, so k = 27 overflows.
‡ Includes: 3 min instance boot + S3 download, 3 min/GiB `zkey new` (64 vCPUs), 1.5 min/GiB contribute, 1.5 min beacon wait, 1 min/GiB in-enclave verify, S3 upload.
§ On-demand price for `r8g.16xlarge` in us-east-1 = **\$3.77 h⁻¹** ⇒ \$0.0628 min⁻¹.

---

### Verification requirement

Because the final `zkey verify` is performed **inside the enclave** and its SHA-256 hash is embedded in the signed attestation, external users only need:

* the attestation document (≈ 1 KB)
* the `final.zkey` file itself (to recompute the hash)

They **do not** need the `.ptau` file or large RAM for their own verification.





### Does a user need the `.ptau` to verify the final key?

* **If verification is run by the enclave** (and its attestation embeds the SHA-256 of `final.zkey`), ordinary users **do not need the `.ptau`**. They just:

  1. Check the COSE signature on the attestation (AWS Nitro root cert).
  2. Hash `final.zkey`; compare to the attested hash.
  3. Optionally recompute the drand beacon value.
* **If users run `snarkjs zkey verify` themselves** they **must** download the same `.ptau` file and have enough RAM (≈ 5 × |`.ptau`|). That becomes impractical above k ≈ 23 on commodity machines.

Hence running the final `zkey verify` inside the enclave (your “k ≤ 26 plan”) makes the ceremony auditable by anyone without large downloads or RAM, while still pushing capacity to k = 27 if you ever need it (users would then need to self-verify).


* **Choose the Phase-1 size first** (smallest power ≥ your circuit’s `nConstraints`).
* Multiply the ptau file size by **≈ 5** and round up to the next AWS flavour that can hand the enclave ≤ 512 GiB.
* In `/etc/nitro_enclaves/allocator.yaml` carve out `cpu_count: min(64, vCPUs)` and `memory_mib` equal to the “enclave RAM” column.
* Keep the Node-parent outside the enclave; it downloads/verifies the ptau, streams it into the enclave over vsock, then receives the `.zkey`.

### 4  Security footnote

All the Graviton-based *-g* families (M8g, R8g, X8g, etc.) run on the same Nitro hardware with **always-on DRAM encryption**; the enclave’s plaintext never leaves the memory controller, regardless of who has physical access.

(Response above generated by o3)

My personal notes:
- We want the parent to have at least 2 vCPUs and the enclave to have at least 2 vCPUs. So min number of vCPUs is 4.
- We should halt early in pre-flight checks (before spinning up the EC2 instance) if the user's circuit is too large to support.
- Just use r8g.24xlarge everywhere.
