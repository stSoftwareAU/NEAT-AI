/* A real C ABI call held on a pipe until the process test releases it. */
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  unsigned char *data;
  size_t len;
  size_t capacity;
} Buffer;

static char *read_file(const char *path) {
  FILE *file = fopen(path, "rb");
  if (!file) abort();
  if (fseek(file, 0, SEEK_END)) abort();
  long size = ftell(file);
  if (size < 0 || fseek(file, 0, SEEK_SET)) abort();
  char *bytes = calloc((size_t)size + 1, 1);
  if (!bytes || fread(bytes, 1, (size_t)size, file) != (size_t)size) abort();
  fclose(file);
  return bytes;
}

uint32_t neat_backprop_abi_version(void) { return 1; }
const char *neat_backprop_version(void) { return "0.1.50"; }
const char *neat_backprop_capabilities(void) {
  static char *capabilities;
  if (!capabilities) capabilities = read_file(getenv("NEAT_TEST_CAPABILITIES"));
  return capabilities;
}

__attribute__((destructor)) static void unloaded(void) {
  puts("NATIVE_LIBRARY_UNLOADED");
  fflush(stdout);
}

int neat_backprop_train(const unsigned char *request, size_t len, Buffer *out) {
  int pipe = open(getenv("NEAT_TEST_RELEASE"), O_RDWR);
  if (pipe < 0) abort();
  printf("NATIVE_TRAIN_ENTERED pid=%ld\n", (long)getpid());
  fflush(stdout);
  char release;
  if (read(pipe, &release, 1) != 1) abort();
  close(pipe);

  /* Read and write after termination: both buffers and code must still live. */
  FILE *capture = fopen(getenv("NEAT_TEST_REQUEST"), "wb");
  if (!capture || fwrite(request, 1, len, capture) != len) abort();
  fclose(capture);
  out->data = (unsigned char *)read_file(getenv("NEAT_TEST_RESPONSE"));
  out->len = strlen((char *)out->data);
  out->capacity = out->len + 1;
  puts("NATIVE_TRAIN_FINISHED");
  fflush(stdout);
  return 0;
}

void neat_backprop_buffer_free(Buffer *out) {
  free(out->data);
  memset(out, 0, sizeof(*out));
}
