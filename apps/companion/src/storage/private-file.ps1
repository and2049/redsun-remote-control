$Lock = $env:REDSUN_PRIVATE_FILE_LOCK -eq '1'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-Path([string] $Path) {
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path.StartsWith('\\') -or $Path.Substring(2).Contains(':')) { throw 'Invalid path' }
  $current = $Path
  while ($current) {
    if ([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) {
      if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }
    }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}

function Assert-Private($Acl) {
  if ($Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $script:sid.Value) { throw 'Invalid owner' }
  foreach ($rule in $Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -ne $script:sid.Value) { throw 'Nonprivate ACL' }
  }
}

function Invoke-Operation($value) {
  Assert-Path $value.path
  switch ($value.action) {
    'remove' {
      Assert-Private ([IO.Directory]::GetAccessControl([IO.Path]::GetDirectoryName($value.path)))
      Assert-Private ([IO.File]::GetAccessControl($value.path))
      [IO.File]::Delete($value.path)
    }
    'directory' {
      if (-not [IO.Directory]::Exists($value.path)) {
        if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($value.path))) { throw 'Missing parent' }
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        [void][IO.Directory]::CreateDirectory($value.path, $acl)
      }
      Assert-Private ([IO.Directory]::GetAccessControl($value.path))
    }
    'read' {
      $stream = [IO.FileStream]::new($value.path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try {
        Assert-Private ($stream.GetAccessControl())
        if ($stream.Length -gt $value.limit) { throw 'File too large' }
        $bytes = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
          $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
          if ($count -eq 0) { throw 'Short read' }
          $offset += $count
        }
        [Console]::Out.Write([Convert]::ToBase64String($bytes))
      } finally { $stream.Dispose() }
    }
    { $_ -eq 'create' -or $_ -eq 'replace' } {
      $parent = [IO.Path]::GetDirectoryName($value.path)
      Assert-Private ([IO.Directory]::GetAccessControl($parent))
      if ($value.action -eq 'replace') { Assert-Private ([IO.File]::GetAccessControl($value.path)) }
      $temporary = [IO.Path]::Combine($parent, [Guid]::NewGuid().ToString('N') + '.tmp')
      $created = $false
      try {
        $acl = [Security.AccessControl.FileSecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
        $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough, $acl)
        $created = $true
        try {
          $bytes = [Convert]::FromBase64String($value.content)
          if ($bytes.Length -gt 16384) { throw 'File too large' }
          $stream.Write($bytes, 0, $bytes.Length)
          $stream.Flush($true)
        } finally { $stream.Dispose() }
        if ($value.action -eq 'replace') { [IO.File]::Replace($temporary, $value.path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $value.path) }
      } finally {
        if ($created -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
      }
    }
    default { throw 'Invalid action' }
  }
}

try {
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $script:sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if (-not $Lock) {
    Invoke-Operation ([Console]::In.ReadToEnd() | ConvertFrom-Json)
  } else {
    $value = [Console]::In.ReadLine() | ConvertFrom-Json
    Assert-Path $value.path
    $owner = [IO.Path]::Combine([IO.Path]::GetDirectoryName($value.path), 'owner.json')
    $lease = [IO.FileStream]::new($value.path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      Assert-Private ($lease.GetAccessControl())
      [Console]::Out.WriteLine('locked')
      [Console]::Out.Flush()
      while ($null -ne ($line = [Console]::In.ReadLine())) {
        try {
          $command = $line | ConvertFrom-Json
          if ($command.action -notin @('create', 'replace', 'remove')) { throw 'Invalid action' }
          $command | Add-Member -NotePropertyName path -NotePropertyValue $owner
          Invoke-Operation $command
          [Console]::Out.WriteLine('ok')
        } catch { [Console]::Out.WriteLine('error') }
        [Console]::Out.Flush()
      }
    } finally { $lease.Dispose() }
  }
} catch { exit 1 }
