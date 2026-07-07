declare module 'qrcode' {
  export type QRCodeErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

  export type QRCodeToDataUrlOptions = {
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel
    margin?: number
    width?: number
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataUrlOptions
  ): Promise<string>

  const QRCode: {
    toDataURL: typeof toDataURL
  }

  export default QRCode
}
