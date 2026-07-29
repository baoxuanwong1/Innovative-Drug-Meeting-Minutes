declare module 'ali-oss' {
  const OSS: any
  export default OSS
}

declare module 'pdf-parse' {
  const parse: (input: Buffer) => Promise<{ text?: string }>
  export = parse
}
