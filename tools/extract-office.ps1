# Read a verified MSI as a database and extract its files. Never execute installer actions.
param([Parameter(Mandatory=$true)][string]$Package,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ZhigaoMsi {
 [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiOpenDatabaseW(string path,IntPtr mode,out uint db);
 [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiDatabaseOpenViewW(uint db,string query,out uint view);
 [DllImport("msi.dll")] static extern uint MsiViewExecute(uint view,uint record);
 [DllImport("msi.dll")] static extern uint MsiViewFetch(uint view,out uint record);
 [DllImport("msi.dll")] static extern uint MsiCloseHandle(uint handle);
 [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiRecordGetStringW(uint record,uint field,StringBuilder value,ref uint size);
 [DllImport("msi.dll")] static extern uint MsiRecordReadStream(uint record,uint field,byte[] buffer,ref uint size);
 static void Check(uint code){if(code!=0)throw new IOException("MSI read failed: "+code);}
 static string Text(uint record,uint field){uint size=32768;var value=new StringBuilder((int)size);Check(MsiRecordGetStringW(record,field,value,ref size));return value.ToString();}
 public static uint Open(string package){uint db;Check(MsiOpenDatabaseW(package,IntPtr.Zero,out db));return db;}
 public static void Close(uint db){MsiCloseHandle(db);}
 public static string[][] Rows(uint db,string query,int fields){
  uint view;Check(MsiDatabaseOpenViewW(db,query,out view));var rows=new List<string[]>();
  try{Check(MsiViewExecute(view,0));uint record;uint code;
   while((code=MsiViewFetch(view,out record))==0){try{var row=new string[fields];for(int i=0;i<fields;i++)row[i]=Text(record,(uint)i+1);rows.Add(row);}finally{MsiCloseHandle(record);}}
   if(code!=259)Check(code);return rows.ToArray();
  }finally{MsiCloseHandle(view);}
 }
 public static void Stream(uint db,string name,string file){
  uint view;Check(MsiDatabaseOpenViewW(db,"SELECT `Data` FROM `_Streams` WHERE `Name`='"+name.Replace("'","''")+"'",out view));
  try{Check(MsiViewExecute(view,0));uint record;Check(MsiViewFetch(view,out record));try{
   using(var output=new FileStream(file,FileMode.CreateNew)){byte[] buffer=new byte[65536];while(true){uint size=(uint)buffer.Length;Check(MsiRecordReadStream(record,1,buffer,ref size));if(size==0)break;output.Write(buffer,0,(int)size);}}
  }finally{MsiCloseHandle(record);}}finally{MsiCloseHandle(view);}
 }
}
'@
$destRoot=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $destRoot){throw 'Extraction destination must be new.'}
[IO.Directory]::CreateDirectory($destRoot) | Out-Null
$cabRoot=Join-Path $destRoot '_cabinets'
[IO.Directory]::CreateDirectory($cabRoot) | Out-Null
$db=[ZhigaoMsi]::Open([IO.Path]::GetFullPath($Package))
try {
 $dirs=@{}
 foreach($row in [ZhigaoMsi]::Rows($db,'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`',3)){$dirs[$row[0]]=@($row[1],$row[2])}
 $components=@{}
 foreach($row in [ZhigaoMsi]::Rows($db,'SELECT `Component`,`Directory_` FROM `Component`',2)){$components[$row[0]]=$row[1]}
 function Resolve-PrivateDirectory([string]$Key){
  $segments=[Collections.Generic.List[string]]::new();$visited=[Collections.Generic.HashSet[string]]::new()
  while($Key -and $Key -ne 'TARGETDIR'){
   if(!$visited.Add($Key) -or !$dirs.ContainsKey($Key)){throw 'Invalid directory tree'}
   $r=$dirs[$Key];$name=($r[1].Split(':')[0].Split('|') | Select-Object -Last 1)
   if($name -and $name -ne '.' -and $name -ne 'SourceDir'){$segments.Insert(0,$name)}
   $Key=$r[0]
  }
  $relative=[string]::Join([IO.Path]::DirectorySeparatorChar,$segments)
  $resolved=[IO.Path]::GetFullPath((Join-Path $destRoot $relative))
  if($resolved -ne $destRoot -and !$resolved.StartsWith($destRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Directory escapes private root'}
  return $resolved
 }
 $index=0
 foreach($row in [ZhigaoMsi]::Rows($db,'SELECT `Cabinet` FROM `Media`',1)){
  if(!$row[0]){continue}
  if(!$row[0].StartsWith('#')){throw 'External cabinet is unsupported'}
  $cab=Join-Path $cabRoot ("data-"+$index+".cab");$index++
  [ZhigaoMsi]::Stream($db,$row[0].Substring(1),$cab)
  & "$env:SystemRoot\System32\expand.exe" '-F:*' $cab $cabRoot | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Cabinet extraction failed'}
 }
 $count=0
 foreach($row in [ZhigaoMsi]::Rows($db,'SELECT `File`,`Component_`,`FileName` FROM `File`',3)){
  # This pinned package is used only on Windows x64; its bundled redistributable also includes other architectures.
  if($row[0] -match '_(arm64|x86)\.') {continue}
  $dir=Resolve-PrivateDirectory $components[$row[1]]
  $filename=($row[2].Split('|') | Select-Object -Last 1)
  if([IO.Path]::GetFileName($filename) -ne $filename -or [IO.Path]::GetFileName($row[0]) -ne $row[0]){throw 'Invalid file name'}
  [IO.Directory]::CreateDirectory($dir) | Out-Null
  $source=Join-Path $cabRoot $row[0];$target=Join-Path $dir $filename
  if(!(Test-Path -LiteralPath $source -PathType Leaf)){throw 'Missing cabinet member'}
  if(Test-Path -LiteralPath $target){
   if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash){throw 'Conflicting package files'}
  } else {[IO.File]::Copy($source,$target,$false)}
  if($row[0] -match '_amd64\.' -and $filename -match '^(vcruntime|msvcp|concrt|vcomp).*\.dll$'){
   $program=Join-Path $destRoot 'LibreOffice\program';[IO.Directory]::CreateDirectory($program) | Out-Null
   [IO.File]::Copy($source,(Join-Path $program $filename),$false)
  }
  $count++
 }
 @{files=$count;destination=$destRoot;mode='database-extraction-no-installer-actions'} | ConvertTo-Json -Compress
} finally {[ZhigaoMsi]::Close($db)}
