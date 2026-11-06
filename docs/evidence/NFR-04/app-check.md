$f = (Resolve-Path docs\\evidence\\NFR-04\\app-check.md).Path

$t = \[IO.File]::ReadAllText($f)

$t = $t.Replace('from branch `fix/nfr-04-app-check` (includes main up to PR-15)', 'from branch `fix/nfr-04-app-check` at `4d8b9c4` (includes main up to PR-15)')

\[IO.File]::WriteAllText($f, $t)

Select-String "4d8b9c4" docs\\evidence\\NFR-04\\app-check.md

