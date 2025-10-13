import { defineConfig } from 'vite'
import { createTargetConfig } from './vite.shared'

export default defineConfig(createTargetConfig('client-node'))

