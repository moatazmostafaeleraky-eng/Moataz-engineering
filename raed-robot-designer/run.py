"""Local launcher: python run.py. Binds loopback only."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'src'))

if __name__=='__main__':
    import uvicorn
    uvicorn.run('raedbots.api.app:app',host='127.0.0.1',port=8765)
