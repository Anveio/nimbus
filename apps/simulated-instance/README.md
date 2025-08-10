# Simulated SSH Instance (Finch / Docker)

## Purpose

This application provides a high-fidelity, container-based development environment that simulates a real-world SSH target. It programmatically builds and runs a container with the **Amazon Linux 2023** operating system and a configured OpenSSH server.

Its primary function is to serve as a realistic endpoint for testing and demonstrating the ManaSSHWeb library, ensuring that our client is developed against a genuine and modern server environment.

This package uses `dockerode` to automatically detect your container runtime (Finch or Docker) and manage the lifecycle of the AL2023 container, making the developer experience seamless.

---

## Prerequisites: Container Runtime

To run this simulated instance, you **must** have a container runtime installed and running on your host machine. The orchestration script will fail if it cannot connect to a daemon socket.

**Finch is the recommended tool for this project** as it is open-source and avoids the licensing complexities of Docker Desktop in enterprise environments.

### Step 1: Install Finch

First, install Finch on your operating system.

#### macOS

**Method 1: Direct Download (Recommended)**

1.  **Download Finch**: Go to the official Finch releases page on GitHub: [https://github.com/runfinch/finch/releases](https://github.com/runfinch/finch/releases)
2.  **Select Asset**: Find the latest release and download the `.pkg` installer for your Mac's chip type (`x86_64` for Intel, `aarch64` for Apple Silicon).
3.  **Run Installer**: Open the downloaded `.pkg` file and follow the installation prompts.

**Method 2: Homebrew (Alternative)**

1.  **Install Homebrew** (if you don't have it already):
    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```
2.  **Install Finch**:
    ```bash
    brew install --cask finch
    ```

#### Windows & Linux

Finch is under active development for other platforms. Please follow the official installation instructions on the project's GitHub page: [https://github.com/runfinch/finch](https://github.com/runfinch/finch)

### Step 2: Getting Started with Finch

After installing Finch for the first time, you must initialize its virtual machine.

1.  **Initialize the VM (One-Time Setup)**:
    This command creates and configures the Finch virtual machine. You only need to run this once.
    ```bash
    finch vm init
    ```

2.  **Start the VM (Every Session)**:
    Before running the dev server, you must ensure the Finch VM is running.
    ```bash
    finch vm start
    ```
    You can check its status at any time with `finch vm status`. The dev script will fail if the VM is not running.

### Alternative: Docker Desktop Installation

If you already have Docker Desktop installed, the script will detect it and use it automatically. Please refer to the official Docker website for installation instructions: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
