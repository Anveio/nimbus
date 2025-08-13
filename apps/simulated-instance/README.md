# Simulated SSH Instance (Finch / Docker)

## Purpose

This application provides a high-fidelity, container-based development environment that simulates a real-world SSH target. It programmatically builds and runs a container with the **Amazon Linux 2023** operating system and a configured OpenSSH server.

Its primary function is to serve as a realistic endpoint for testing and demonstrating the ManaSSHWeb library, ensuring that our client is developed against a genuine and modern server environment.

## Supported Environments

This script is designed to be runtime-agnostic and seamlessly supports both **Finch** and **Docker Desktop**. It automatically detects which container daemon is running by searching for a valid socket in the following locations:

1.  `~/.finch/finch.sock` (Finch, standard path)
2.  `/Applications/Finch/lima/data/finch/sock/finch.sock` (Finch, alternative macOS path)
3.  `/var/run/docker.sock` (Docker Desktop, standard path)

**Finch is the recommended tool for this project** as it is open-source and avoids the licensing complexities of Docker Desktop in enterprise environments.

---

#### macOS Installation

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

```bash
finch vm init
```

Before running the dev server, you must ensure the Finch VM is running. **You will need to do this for every new terminal session or system restart.**

```bash
finch vm start
```

You can check its status at any time with `finch vm status`.

## Usage

Once your container runtime is running, you can start the simulated SSH instance.

1.  **Navigate to the package directory**:
    ```bash
    cd apps/simulated-instance
    ```

2.  **Run the development server**:
    ```bash
    bun dev
    ```

The script will then:
1.  Build the `mana-ssh-instance` Docker image.
2.  Start a container from that image.
3.  Expose the container's SSH port (22) on `localhost:2222`.

### Cleaning Up

Closing bun automatically stops and removes the **container**, but it leaves the **image** cached on your system. This ensures that the next time you run `bun dev`, the instance starts almost instantly without needing a full rebuild.

If you want to perform a complete cleanup and remove both the container and the underlying `mana-ssh-instance` image, you can run the dedicated `clean` script. This is useful when you want to reclaim disk space or ensure your next build is completely fresh.

1.  **Navigate to the package directory**:
    ```bash
    cd apps/simulated-instance
    ```

2.  **Run the clean script**:
    ```bash
    bun run clean
    ```

This script will:
1.  Stop the running container (if it exists).
2.  Remove the container.
3.  Remove the `mana-ssh-instance` image.

---

## Dependencies

This package relies on a few key dependencies to manage the container lifecycle.

### Production Dependencies

-   **`dockerode`**: A library that provides a programmatic interface to the Docker (or Finch) daemon API. This is the core dependency used to build, start, stop, and remove the container.
-   **`tar`**: Used to create a tarball stream of the build context (`Dockerfile`, keys, etc.) in memory. This stream is then passed to `dockerode` to build the image, which is more reliable across different container daemons than file-based context.

 