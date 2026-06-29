import { Buffer } from 'node:buffer'
import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  STORE_IMPORT_ALLOWED_CHAINS,
  STORE_IMPORT_HEADERS,
} from '@/lib/stores/import'

type StoresTemplateAccessRow = {
  role: string | null
  can_view_stores: boolean | null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_stores')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json(
      { error: 'Nepodařilo se ověřit oprávnění.' },
      { status: 403 }
    )
  }

  const typedProfile = profile as StoresTemplateAccessRow
  const hasAccess =
    typedProfile.role === 'admin' || Boolean(typedProfile.can_view_stores)

  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Nemáš oprávnění pro stažení šablony.' },
      { status: 403 }
    )
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'B-ENERGY CRM'
  workbook.created = new Date()

  const importSheet = workbook.addWorksheet('Import')
  importSheet.addRow([...STORE_IMPORT_HEADERS])
  importSheet.views = [{ state: 'frozen', ySplit: 1 }]

  const headerRow = importSheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: 'middle' }
  headerRow.height = 22

  const widths = [18, 18, 20, 34, 22, 22, 22]
  widths.forEach((width, index) => {
    importSheet.getColumn(index + 1).width = width
  })

  const instructionsSheet = workbook.addWorksheet('Instrukce')
  instructionsSheet.columns = [
    { header: 'Pole', key: 'field', width: 26 },
    { header: 'Pravidlo', key: 'rule', width: 82 },
  ]
  instructionsSheet.getRow(1).font = { bold: true }
  instructionsSheet.addRows([
    {
      field: 'chain_name',
      rule: `Povinné. Povolené hodnoty: ${STORE_IMPORT_ALLOWED_CHAINS.join(', ')}. V jednom souboru musí být vždy jen jeden řetězec.`,
    },
    {
      field: 'store_number',
      rule: 'Povinné. Interní číslo prodejny v rámci daného řetězce.',
    },
    {
      field: 'city',
      rule: 'Povinné. Město prodejny.',
    },
    {
      field: 'address',
      rule: 'Povinné. Ulice a číslo popisné v samostatném poli.',
    },
    {
      field: 'phone_1',
      rule: 'Povinné. Hlavní telefon na prodejnu.',
    },
    {
      field: 'phone_2',
      rule: 'Volitelné. Druhý telefon může zůstat prázdný.',
    },
    {
      field: 'phone_3',
      rule: 'Volitelné. Třetí telefon může zůstat prázdný.',
    },
    {
      field: 'Import',
      rule: 'Chybné řádky se nepřenesou. Validní řádky lze importovat i když soubor obsahuje chyby.',
    },
  ])

  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="Prodejny-import-sablona.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
