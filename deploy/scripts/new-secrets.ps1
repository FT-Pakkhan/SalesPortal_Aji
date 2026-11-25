# Prints new random values for portal.env: JWT_SECRET and SETTINGS_SECRET_KEY (cryptographically random).
# Only use a new SETTINGS_SECRET_KEY for a new database: with a copied database keep the old key (see portal.env.example).
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$jwt = New-Object byte[] 48
$key = New-Object byte[] 32
$rng.GetBytes($jwt)
$rng.GetBytes($key)
Write-Host "JWT_SECRET=$([Convert]::ToBase64String($jwt))"
Write-Host "SETTINGS_SECRET_KEY=$([Convert]::ToBase64String($key))"
