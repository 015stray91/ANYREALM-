
export const generateKernelCompilerWorkflow = () => {
  return `
name: Kernel Compiler

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v5
      - name: Set up Node.js v24 Environment
        uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: Build Kernel
        run: |
          export LLVM=-12
          ./compile-kernel.sh
`;
};

export const generateRomBuilderWorkflow = () => {
  return `
name: ROM Builder

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v5
      - name: Set up Node.js v24 Environment
        uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: Retail Carrier Mitigation
        run: |
          # Isolate NON-HLOS.bin (handled by build system)
          # Scavenge carrier bloatware and overlays
          rm -rf ./extracted_partitions/product/app/*
          rm -rf ./extracted_partitions/product/overlay/*
          echo "[LINEAGE SYNC]: Retaining baseband network binaries... Mapping device parameters to LineageOS CarrierConfig trees."
      - name: Build ROM
        run: |
          ./build-rom.sh
`;
};
