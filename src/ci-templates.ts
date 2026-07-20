export const githubActionTemplate = `name: AOSP ROM Builder

on:
  push:
    branches: [ main ]
  workflow_dispatch:

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
      - name: Build ROM
        run: |
          ./build-rom.sh
`;

export const gitlabCiTemplate = `build:
  stage: build
  script:
    - ./build-rom.sh
`;
