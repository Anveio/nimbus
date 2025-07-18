import nodeConfig from '../mana-ssh-eslint-config/src/node.js';

export default [
  ...nodeConfig,
  {
    ignores: ["dist/**"],
  },
];