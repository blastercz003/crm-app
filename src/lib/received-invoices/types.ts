export type ReceivedInvoiceStatus = 'unpaid' | 'paid'

export type ReceivedInvoiceFilter = 'all' | 'unpaid' | 'paid'

export type ReceivedInvoiceRow = {
  id: string
  file_path: string
  file_name: string
  file_size: number
  mime_type: string
  status: ReceivedInvoiceStatus
  due_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

