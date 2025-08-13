# Use the official Amazon Linux 2023 image as a base
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# Install OpenSSH server and sudo (for potential debugging)
RUN dnf install -y openssh-server sudo && dnf clean all

# Create a non-root user for SSH access
RUN useradd -m -s /bin/bash testuser

# Create the .ssh directory for the new user
RUN mkdir /home/testuser/.ssh && \
    chmod 700 /home/testuser/.ssh

# Copy the public key and set up authorized_keys
COPY id_rsa.pub /home/testuser/.ssh/authorized_keys
RUN chown -R testuser:testuser /home/testuser/.ssh && \
    chmod 600 /home/testuser/.ssh/authorized_keys

# Create the host keys for the SSH server
RUN ssh-keygen -A

# Expose the SSH port
EXPOSE 22

# Start the SSH daemon in the foreground in debug mode
CMD ["/usr/sbin/sshd", "-D", "-d"]
