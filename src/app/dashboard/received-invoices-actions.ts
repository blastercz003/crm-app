'use server'

import {
  archiveReceivedInvoiceNotifications,
  deleteReceivedInvoice,
  getReceivedInvoiceBadgeCount,
  getReceivedInvoiceSignedUrl,
  getReceivedInvoices,
  setReceivedInvoiceDueDate,
  setReceivedInvoiceStatus,
  uploadReceivedInvoiceFile,
} from '@/lib/received-invoices/service'

export async function getReceivedInvoicesAction(filter?: string) {
  try {
    const rows = await getReceivedInvoices({ filter, limit: 500 })
    return { success: true, error: null, rows }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se načíst faktury.',
      rows: [],
    }
  }
}

export async function getReceivedInvoiceBadgeCountAction() {
  try {
    const count = await getReceivedInvoiceBadgeCount()
    return { success: true, error: null, count }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se načíst počet faktur.',
      count: 0,
    }
  }
}

export async function uploadSingleReceivedInvoiceAction(formData: FormData) {
  try {
    const rawDueDate = String(formData.get('due_date') ?? '').trim()
    const dueDate = rawDueDate || null
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return { success: false, error: 'Nebyl vybrán soubor.', row: null }
    }

    if (!dueDate) {
      return { success: false, error: 'U jednoho souboru je datum splatnosti povinné.', row: null }
    }

    const row = await uploadReceivedInvoiceFile({ file, dueDate })

    return { success: true, error: null, row }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nahrání souboru selhalo.',
      row: null,
    }
  }
}

export async function uploadMultipleReceivedInvoicesAction(formData: FormData) {
  try {
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)

    if (files.length === 0) {
      return { success: false, error: 'Vyber alespoň jeden soubor.', uploadedCount: 0 }
    }

    let uploadedCount = 0
    for (const file of files) {
      await uploadReceivedInvoiceFile({ file, dueDate: null })
      uploadedCount += 1
    }

    return { success: true, error: null, uploadedCount }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nahrání souborů selhalo.',
      uploadedCount: 0,
    }
  }
}

export async function toggleReceivedInvoiceStatusAction(
  invoiceId: string,
  status: 'unpaid' | 'paid'
) {
  try {
    const row = await setReceivedInvoiceStatus({ invoiceId, status })
    if (status === 'paid') {
      await archiveReceivedInvoiceNotifications(invoiceId)
    }
    return { success: true, error: null, row }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se změnit stav faktury.',
      row: null,
    }
  }
}

export async function setReceivedInvoiceDueDateAction(
  invoiceId: string,
  dueDate: string | null
) {
  try {
    const row = await setReceivedInvoiceDueDate({ invoiceId, dueDate })
    return { success: true, error: null, row }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se upravit splatnost.',
      row: null,
    }
  }
}

export async function deleteReceivedInvoiceAction(invoiceId: string) {
  try {
    await archiveReceivedInvoiceNotifications(invoiceId)
    await deleteReceivedInvoice(invoiceId)
    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se smazat fakturu.',
    }
  }
}

export async function getReceivedInvoicePreviewUrlAction(invoiceId: string) {
  try {
    const signedUrl = await getReceivedInvoiceSignedUrl({ invoiceId, download: false })
    return { success: true, error: null, signedUrl }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se načíst náhled.',
      signedUrl: null,
    }
  }
}

export async function getReceivedInvoiceDownloadUrlAction(invoiceId: string) {
  try {
    const signedUrl = await getReceivedInvoiceSignedUrl({ invoiceId, download: true })
    return { success: true, error: null, signedUrl }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se načíst odkaz ke stažení.',
      signedUrl: null,
    }
  }
}
