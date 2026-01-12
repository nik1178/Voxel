// Custom console.log that only prints if verbose = true
export function vprint(...args) {
  const verbose = true; // Set to false to disable verbose logging
  if (verbose) {
    console.log(...args);
  }
}