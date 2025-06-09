#include <nsm.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NSM_ATTESTATION_DOC_SIZE (16 * 1024)

// Decode a hex string (2 chars per byte) into the given buffer.
// Returns number of bytes written or -1 on parse error.
static int hexstr_to_bytes(const char *hex, uint8_t *out, size_t max_len) {
    size_t hex_len = strlen(hex);
    if (hex_len % 2 != 0) return -1;
    size_t bytes_len = hex_len / 2;
    if (bytes_len > max_len) return -1;

    for (size_t i = 0; i < bytes_len; i++) {
        char byte_str[3] = { hex[2 * i], hex[2 * i + 1], 0 };
        char *endptr;
        unsigned long val = strtoul(byte_str, &endptr, 16);
        if (*endptr != '\0') return -1;
        out[i] = (uint8_t) val;
    }
    return (int)bytes_len;
}

int main(int argc, char **argv) {
    // Optional CLI arguments (positional):
    //   argv[1] – hex-encoded nonce   (≤ 64 bytes ⇒ ≤ 128 hex chars)
    //   argv[2] – hex-encoded userData (≤ 512 bytes ⇒ ≤ 1024 hex chars)

    uint8_t nonce[64];
    int nonce_size = 0;

    uint8_t user_data[512];
    int user_data_size = 0;

    // Parse nonce if provided (argv[1]).  For backwards compatibility the
    // tool still works when only the nonce argument is given.
    if (argc > 1 && strlen(argv[1]) > 0) {
        nonce_size = hexstr_to_bytes(argv[1], nonce, sizeof(nonce));
        if (nonce_size < 0) {
            fprintf(stderr, "Invalid nonce hex string. Must be up to 128 hex chars and even length.\n");
            return 1;
        }
    }

    // Parse user-provided data if supplied (argv[2]).
    if (argc > 2 && strlen(argv[2]) > 0) {
        user_data_size = hexstr_to_bytes(argv[2], user_data, sizeof(user_data));
        if (user_data_size < 0) {
            fprintf(stderr, "Invalid user-data hex string. Must be up to 1024 hex chars and even length.\n");
            return 1;
        }
    }

    int fd = nsm_lib_init();
    if (fd < 0) {
        fprintf(stderr, "Failed to init NSM\n");
        return 1;
    }

    uint8_t doc[NSM_ATTESTATION_DOC_SIZE];
    uint32_t doc_size = NSM_ATTESTATION_DOC_SIZE;

    int result = nsm_get_attestation_doc(fd,
                                          user_data_size ? user_data : NULL, // userdata pointer
                                          (uint32_t)user_data_size,           // userdata length
                                          nonce_size ? nonce : NULL,          // nonce pointer
                                          (uint32_t)nonce_size,               // nonce length
                                          NULL, 0,                            // pcrs (unused)
                                          doc, &doc_size);
    if (result != 0) {
        fprintf(stderr, "Failed to get attestation document\n");
        return 1;
    }

    // Print raw CBOR to stdout
    fwrite(doc, 1, doc_size, stdout);
    return 0;
}
