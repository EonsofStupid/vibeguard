@echo off
setlocal
pushd "%~dp0..\vibeguard"
if errorlevel 1 exit /b 1
call corepack pnpm add --save-dev --save-exact prisma@6.19.3
if errorlevel 1 goto failed
call corepack pnpm add --save-exact @prisma/client@6.19.3
if errorlevel 1 goto failed
call corepack pnpm run db:generate
if errorlevel 1 goto failed
echo Prisma packages installed and client generated. Database connectivity has not been tested.
popd
exit /b 0
:failed
echo Prisma setup stopped after a failed command. It is not complete.
popd
exit /b 1
