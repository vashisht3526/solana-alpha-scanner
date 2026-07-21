@echo off
echo ====================================================
echo 🚀 SOLANA ALPHA SCANNER — AZURE DEPLOYMENT ASSISTANT
echo ====================================================
echo.

:: Step 1: Initialize Git and commit files
echo 📦 Step 1: Initializing Git repository...
if not exist .git (
    git init
)
git add .
git commit -m "Deploy to Azure Static Web App" --quiet
echo.

:: Step 2: Push to GitHub
echo 🌐 Step 2: Pushing to GitHub...
echo.
echo [IMPORTANT] Please make sure you have created a repository on GitHub (https://github.com/new) first.
echo.
echo Please enter your GitHub username (e.g., johndoe):
set /p GH_USER=
echo Please enter your repository name (e.g., solana-alpha-scanner):
set /p GH_REPO=

:: Add remote and push
git remote remove origin 2>nul
git remote add origin https://github.com/%GH_USER%/%GH_REPO%.git
git branch -M main
echo.
echo Pushing code to GitHub...
git push -u origin main
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ Git push failed. Please make sure you created the repository on GitHub first!
    pause
    exit /b 1
)
echo.

:: Step 3: Create Azure Static Web App
echo ⚡ Step 3: Creating Azure Static Web App...
echo.
echo [NOTE] This will open a browser window to authorize Azure to deploy from your GitHub account.
echo.
az staticwebapp create ^
  --name solana-alpha-scanner ^
  --resource-group solana-scanner-rg ^
  --source https://github.com/%GH_USER%/%GH_REPO% ^
  --branch main ^
  --location eastasia ^
  --app-location . ^
  --login-with-github

if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ Azure deployment failed.
    pause
    exit /b 1
)

echo.
echo ====================================================
echo 🎉 DEPLOYMENT INITIATED SUCCESSFULY!
echo ====================================================
echo.
echo 1. Your app is now building and deploying on Azure.
echo 2. Check the GitHub Actions tab in your repository for progress.
echo 3. The command output above shows the live URL once it's created.
echo.
echo ====================================================
pause
