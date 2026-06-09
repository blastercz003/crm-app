'use server'

import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'

const MAX_IMAGE_WIDTH = 1920
const JPEG_QUALITY_STEPS = [82, 74, 66, 58]
const JPEG_SIZE_TARGET_BYTES = 1 * 1024 * 1024

function replaceFileExtension(fileName: string, nextExtension: string) {
  const trimmed = String(fileName ?? '').trim()
  if (!trimmed) return `soubor.${nextExtension}`

  const lastDotIndex = trimmed.lastIndexOf('.')
  if (lastDotIndex <= 0) {
    return `${trimmed}.${nextExtension}`
  }

  return `${trimmed.slice(0, lastDotIndex)}.${nextExtension}`
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/')
}

function toArrayBuffer(bytes: Uint8Array | Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function optimizePdfFile(file: File) {
  const originalBytes = Buffer.from(await file.arrayBuffer())

  try {
    const pdfDocument = await PDFDocument.load(originalBytes, {
      ignoreEncryption: false,
    })

    const optimizedBytes = await pdfDocument.save({
      useObjectStreams: true,
      addDefaultPage: false,
    })

    if (optimizedBytes.length < originalBytes.length) {
      return new File([toArrayBuffer(optimizedBytes)], file.name, {
        type: 'application/pdf',
        lastModified: file.lastModified,
      })
    }
  } catch {
    // Pokud PDF nejde bezpečně přepsat, vrátíme originál beze změny.
  }

  return file
}

async function optimizeImageFile(file: File) {
  const originalBytes = Buffer.from(await file.arrayBuffer())
  const resolvedMimeType = String(file.type ?? '').trim().toLowerCase()
  const outputFileName = replaceFileExtension(file.name, 'jpg')

  let bestCandidate: { bytes: Buffer; quality: number } | null = null

  for (const quality of JPEG_QUALITY_STEPS) {
    const nextBytes = await sharp(originalBytes)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: MAX_IMAGE_WIDTH,
        withoutEnlargement: true,
      })
      .jpeg({
        quality,
        mozjpeg: true,
        progressive: true,
      })
      .toBuffer()

    if (!bestCandidate || nextBytes.length < bestCandidate.bytes.length) {
      bestCandidate = { bytes: nextBytes, quality }
    }

    if (nextBytes.length <= JPEG_SIZE_TARGET_BYTES) {
      return new File([toArrayBuffer(nextBytes)], outputFileName, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      })
    }
  }

  if (bestCandidate && bestCandidate.bytes.length < originalBytes.length) {
    return new File([toArrayBuffer(bestCandidate.bytes)], outputFileName, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  }

  if (resolvedMimeType === 'image/jpeg') {
    return file
  }

  // Pokud obraz nejde smysluplně zmenšit, vrátíme originál.
  return file
}

export async function optimizeUploadFile(file: File) {
  const mimeType = String(file.type ?? '').trim().toLowerCase()

  if (mimeType === 'application/pdf') {
    return optimizePdfFile(file)
  }

  if (isImageMimeType(mimeType)) {
    return optimizeImageFile(file)
  }

  return file
}
