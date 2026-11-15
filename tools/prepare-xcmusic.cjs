const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync('python',[path.join(__dirname,'prepare-xcmusic.py')],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true});
process.exitCode=result.status ?? 1;
