#!/usr/bin/env node
import process from 'node:process'
import { spawn } from 'node:child_process'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader'

function getProfileName() {
  return (process.env.AWS_PROFILE ?? 'default').trim() || 'default'
}

function pickRegionFromConfig(configFile, profile) {
  if (!configFile) {
    return undefined
  }
  if (profile === 'default') {
    return configFile.default?.region ?? configFile['profile default']?.region
  }
  return (
    configFile[`profile ${profile}`]?.region ??
    configFile[profile]?.region ??
    configFile.default?.region ??
    configFile['profile default']?.region
  )
}

export async function ensureCdkEnv() {
  const profile = getProfileName()

  let region =
    process.env.CDK_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    undefined

  if (!region) {
    try {
      const { configFile } = await loadSharedConfigFiles({ profile })
      region = pickRegionFromConfig(configFile, profile)
    } catch (error) {
      throw new Error(
        `Unable to load AWS config for profile "${profile}". Ensure you have run 'aws configure' or 'aws sso login'. Original error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!region) {
    throw new Error(
      [
        `Unable to determine AWS region for profile "${profile}".`,
        'Set a region by running:',
        `  aws configure set region <REGION> --profile ${profile}`,
        'or export:',
        '  export AWS_REGION=<REGION>',
      ].join('\n'),
    )
  }

  process.env.AWS_SDK_LOAD_CONFIG ??= '1'
  process.env.CDK_DEFAULT_REGION ??= region
  process.env.AWS_REGION ??= region
  process.env.AWS_DEFAULT_REGION ??= region

  let account =
    process.env.CDK_DEFAULT_ACCOUNT ??
    process.env.AWS_ACCOUNT_ID ??
    undefined

  if (!account) {
    try {
      const sts = new STSClient({ region })
      const identity = await sts.send(new GetCallerIdentityCommand({}))
      account = identity.Account ?? undefined
    } catch (error) {
      throw new Error(
        `Unable to resolve AWS account using profile "${profile}". Ensure you are logged in (e.g. 'aws sso login --profile ${profile}' or export AWS credentials). Original error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!account) {
    throw new Error(
      `Unable to determine AWS account. Set CDK_DEFAULT_ACCOUNT/AWS_ACCOUNT_ID or authenticate with the "${profile}" profile.`,
    )
  }

  process.env.CDK_DEFAULT_ACCOUNT ??= account
  process.env.AWS_ACCOUNT_ID ??= account

  process.stderr.write(
    `Using AWS profile "${profile}" (account ${account}) in region ${region}\n`,
  )

  return { profile, account, region }
}

export async function ensureCdkBootstrap({
  profile,
  account,
  region,
}) {
  const ssm = new SSMClient({ region })
  try {
    await ssm.send(
      new GetParameterCommand({
        Name: '/cdk-bootstrap/hnb659fds/version',
      }),
    )
    return
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'ParameterNotFound'
    ) {
      process.stderr.write(
        `CDK bootstrap resources missing for aws://${account}/${region}; bootstrapping automatically...\n`,
      )
      const target = `aws://${account}/${region}`
      const executionPolicies =
        process.env.MANA_CDK_EXECUTION_POLICIES ??
        'arn:aws:iam::aws:policy/AdministratorAccess'

      const bootstrapArgs = [
        'cdk',
        'bootstrap',
        target,
        '--profile',
        profile,
      ]

      if (executionPolicies.length > 0) {
        bootstrapArgs.push(
          '--cloudformation-execution-policies',
          executionPolicies,
        )
      }

      const bootstrap = spawn('npx', bootstrapArgs, {
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
      })

      let stderrBuffer = ''
      bootstrap.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk)
      })
      bootstrap.stderr?.on('data', (chunk) => {
        stderrBuffer += chunk.toString()
        process.stderr.write(chunk)
      })

      const exitCode = await new Promise((resolve, reject) => {
        bootstrap.on('error', reject)
        bootstrap.on('close', resolve)
      })

      if (exitCode !== 0) {
        const authHint =
          stderrBuffer.includes('AccessDenied') ||
          stderrBuffer.includes('not authorized')
            ? [
                'AWS denied permission to bootstrap using the current credentials.',
                'Ensure your profile can assume the AdministratorAccess role (e.g. SSO login into the AdministratorAccess permission set),',
                'or rerun the command after exporting credentials with sufficient IAM privileges.',
              ]
            : []
        throw new Error(
          [
            `Automatic bootstrap failed for aws://${account}/${region}.`,
            ...authHint,
            'You may need to run the command manually:',
            `  npx ${bootstrapArgs.join(' ')}`,
          ].join('\n'),
        )
      }
      return
    }
    throw error
  }
}
