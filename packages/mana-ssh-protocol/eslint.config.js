import browserConfig from 'mana-ssh-eslint-config/browser';

export default [
  ...browserConfig,
  {
    ignores: ["dist/**"],
  },
];