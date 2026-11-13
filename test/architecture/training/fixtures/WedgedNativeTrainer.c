/* A real C ABI call held on a pipe until the process test releases it. */
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
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

#ifndef TRAINER_CLI
__attribute__((destructor)) static void unloaded(void) {
  puts("NATIVE_LIBRARY_UNLOADED");
  fflush(stdout);
}
#endif

static void wait_for_release(void) {
  if (getenv("NEAT_TEST_NO_WAIT")) return;
  int pipe = open(getenv("NEAT_TEST_RELEASE"), O_RDWR);
  if (pipe < 0) abort();
  const char *started = getenv("NEAT_TEST_STARTED");
  char *temporary = malloc(strlen(started) + 5);
  if (!temporary) abort();
  sprintf(temporary, "%s.tmp", started);
  FILE *notification = fopen(temporary, "w");
  if (!notification) abort();
  fprintf(notification, "%ld", (long)getpid());
  fclose(notification);
  if (rename(temporary, started)) abort();
  free(temporary);
  printf("NATIVE_TRAIN_ENTERED pid=%ld\n", (long)getpid());
  fflush(stdout);
  char release;
  if (read(pipe, &release, 1) != 1) abort();
  close(pipe);
}

int neat_backprop_train(const unsigned char *request, size_t len, Buffer *out) {
  wait_for_release();
  /* Read and write after termination: both buffers and code must still live. */
  FILE *capture = fopen(getenv("NEAT_TEST_REQUEST"), "wb");
  if (!capture || fwrite(request, 1, len, capture) != len) abort();
  fclose(capture);
  if (getenv("NEAT_TEST_ERROR")) {
    out->data = (unsigned char *)strdup("native fixture rejected training");
    out->len = strlen((char *)out->data);
    out->capacity = out->len + 1;
    return 2;
  }
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

#ifdef TRAINER_CLI
int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "capabilities")) {
    puts(neat_backprop_capabilities());
    return 0;
  }
  if (argc < 4 || strcmp(argv[1], "train")) return 2;
  char *creature = read_file(argv[2]);
  free(creature);
  struct stat dataset;
  if (stat(argv[3], &dataset) || !S_ISDIR(dataset.st_mode)) {
    fputs("native fixture dataset directory not found\n", stderr);
    return 2;
  }
  const char *output = NULL;
  for (int i = 4; i + 1 < argc; ++i) {
    if (!strcmp(argv[i], "--output-dir")) output = argv[i + 1];
  }
  if (!output) return 2;
  wait_for_release();
  if (getenv("NEAT_TEST_ERROR")) {
    fputs("native fixture rejected training\n", stderr);
    return 3;
  }
  char *result = read_file(getenv("NEAT_TEST_RESPONSE"));
  char *path = malloc(strlen(output) + 13);
  if (!path) abort();
  sprintf(path, "%s/result.json", output);
  FILE *file = fopen(path, "w");
  if (!file || fputs(result, file) < 0) abort();
  fclose(file);
  free(path);
  free(result);
  return 0;
}
#endif
