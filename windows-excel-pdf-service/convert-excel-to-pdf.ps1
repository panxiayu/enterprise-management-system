param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$excel = $null
$workbook = $null

try {
  if (!(Test-Path $InputPath)) {
    throw "Excel 文件不存在: $InputPath"
  }

  $outputDir = Split-Path -Parent $OutputPath
  if (!(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
  }

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false

  $workbook = $excel.Workbooks.Open($InputPath, 0, $true)
  $xlTypePDF = 0
  $workbook.ExportAsFixedFormat($xlTypePDF, $OutputPath)

  if (!(Test-Path $OutputPath)) {
    throw "PDF 导出失败，未生成输出文件: $OutputPath"
  }
}
finally {
  if ($workbook -ne $null) {
    $workbook.Close($false) | Out-Null
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
  if ($excel -ne $null) {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
