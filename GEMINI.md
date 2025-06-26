<project-brief>
The project is to create an open source library, written in TypeScript, that allows for bi-directional communication over WebSocket via a simulated SSH connection within a web browser. This is currently an internal project at AWS, the PRFAQ for the project is here:

Amazon Announces ManaSSHWeb: A Fast, Secure TypeScript Implementation for Web-Based Terminal experiences over SSH

**SEATTLE - June 23, 2025** - Today, Amazon Web Services announced the release of ManaSSHWeb, an internal TypeScript library enabling end-to-end encrypted, high-performance SSH connections with strong delivery guarantees in web-based terminal interfaces. This library powers 700,000 Amazon EC2 Instance Connect sessions per week and can be integrated into any web application requiring terminal access to compute resources.

Previously, web-based SSH terminals relied on WebAssembly (WASM) compiled from Go code, requiring a large download, significant initialization time, and creating maintenance complexity. ManaSSHWeb eliminates these issues with a pure IypeScript implementation using modern Web APls, resulting in 70% faster connection times and improved reliability.
"Our customers rely on secure terminal access as a critical tool for managing their infrastructure," said Jane Smith, VP of Compute Services at AWS. "By implementing SSH in TypeScript, we're dramatically improving performance, usability, and security for all AWS services offering terminal connections while also open-sourcing the library for the broader Amazon developer community to use and contribute to."

As Generative Al becomes increasingly integral to cloud operations, ManaSSHWeb has been architected to serve as a foundational layer for Al-powered terminal experiences. "We're seeing tremendous customer interest in Al assistants that can directly interact with infrastructure through the command line," noted John Doe, Director of AWS Bedrock."ManaSSHWeb provides the secure, high-performance terminal substrate that makes these next-generation experiences possible, enabling services like Claude Code and Amazon Q CLI to work seamlessly with terminal environments."

The library provides a consistent, secure SSH implementation across AWS services including EC2 Instance Connect, CloudShell, Lightsail, and ssh.corp. Additionally, the TypeScript implementation makes the library easily extensible and maintainable, enabling faster innovation on terminal-driven experiences.

ManaSSHWeb is available today as an internal package with plans for public release in Q4 2026.
</project-brief>

# Your user

The user is Shovon Hasan (alias @shovonh), an L5 engineer working at AWS on the EC2 Instance Connect product. My aim is to get promoted by finding ways to make EC2 Instance Connect the best SSH + terminal interface in the entire world and I aim to do this by upholding AWS' strict security standards while simultaneously finding ways to improve the UX through sub millisecond response times, and supporting the latest in SSH spec extensions.
