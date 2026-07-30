const TINYMIST_VERSION = '0.15.2'
const TINYMIST_TYPST_VERSION = '0.15.0'

const TINYMIST_TARGETS = {
  'linux-x64': {
    asset: 'tinymist-x86_64-unknown-linux-gnu.tar.gz',
    sha256: '9b8a1aea6bb3fc9c39cb70496f0082bd518cfede555757bc3cb5225b05abc99b',
  },
  'linux-arm64': {
    asset: 'tinymist-aarch64-unknown-linux-gnu.tar.gz',
    sha256: 'eba8e14338cf211906d77be6b18102736222da6721e98161133fa0d8ff5ab599',
  },
  'darwin-x64': {
    asset: 'tinymist-x86_64-apple-darwin.tar.gz',
    sha256: 'fcfcfd01376394048443f81de349d165c271c17c36579eb9a08b889b30b8c3b2',
  },
  'darwin-arm64': {
    asset: 'tinymist-aarch64-apple-darwin.tar.gz',
    sha256: '16241868c6752aa5e8f9c162562293c7cdf69e82f54687d7886336daf2c51915',
  },
  'win32-x64': {
    asset: 'tinymist-x86_64-pc-windows-msvc.zip',
    sha256: '91edb0d21edca5841b896d702d8086622792d52b71a9b444d8befb0e937969ae',
  },
  'win32-arm64': {
    asset: 'tinymist-aarch64-pc-windows-msvc.zip',
    sha256: 'ed120fc474a07c5614bb8a7ecd17a649360cba26c2d9f1f96b14a8bc7b3afc11',
  },
}

module.exports = { TINYMIST_TARGETS, TINYMIST_TYPST_VERSION, TINYMIST_VERSION }
