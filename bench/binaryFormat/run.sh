#!/bin/bash
set -e

BASE_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

cd "${BASE_DIR}/../../"

# Path to your Deno script
SCRIPT_PATH="bench/binaryFormat/Read.ts"

# Check if the script file exists
if [ ! -f "$SCRIPT_PATH" ]; then
  echo "Script file $SCRIPT_PATH not found!"
  exit 1
fi

# Initialize total time variable
total_time=0

# Run the script 10 times
for i in {1..10}
do
  echo "Run $i:"
  start_time=$(gdate +%s%N)
  deno run --allow-read "$SCRIPT_PATH"
  end_time=$(gdate +%s%N)
  
  # Calculate the elapsed time in milliseconds
  elapsed_time=$(( (end_time - start_time) / 1000000 ))
  echo "Time taken: ${elapsed_time} ms"
  echo ""
  
  # Add elapsed time to total time
  total_time=$((total_time + elapsed_time))
done

# Calculate the average time
average_time=$((total_time / 10))

echo "Average time taken: ${average_time} ms"
