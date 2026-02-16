# Main driver file to set up the server
# System imports
import asyncio
from os import getenv, path

# External imports
from dotenv import load_dotenv

import torch
from pydantic import BaseModel

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
import uvicorn

# Local imports
from llm import LLM


#------------- Environment prep ------------#
# Automatic device recognition
device = "cpu"
if torch.cuda.is_available(): device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available(): device = "mps"
print(f"Using device {device}")

# Read in environment variables
app_base_path = path.dirname(__file__)
app_root_path = path.join(app_base_path, '../')
load_dotenv(dotenv_path=path.join(app_root_path, '.env'))

server_http_host=getenv("SERVER_HTTP_HOST")
api_http_port=int(getenv("API_HTTP_PORT"))
api_http_url=getenv("API_HTTP_URL")

ui_folder_root="frontend"
# ui_proxy_launch_cmd = getenv("UI_PROXY_LAUNCH_CMD")

app_frontend_path = path.join(app_root_path, ui_folder_root)



#------------- API ------------#
# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message):
        for connection in self.active_connections:
            await connection.send_json(message)
        # Return control to the event loop so that messages are broadcast individually
        await asyncio.sleep(0)

manager = ConnectionManager()


# Launch the app
class Question(BaseModel):
    prompt: str

app = FastAPI()

# Define global variables
@app.on_event("startup")
def startup_event():
    global llm
    llm = LLM(device)

# Route for testing the API
@app.get("/")
async def root():
    return {"message": "Hello from FastAPI!"}

# Route for getting a response to a query
@app.post('/ask')
async def ask(question: Question):
    # print(question)
    return StreamingResponse(
        llm.generator_dynamic(question.prompt),
        media_type='text/event-stream'
    )

# Route for testing websockets
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket)
    try:
        while True:
            input = await websocket.receive_json()
            if input["type"] == "start_game":
                prompt = input["data"]
                await manager.broadcast({ "type": "prompt", "data": prompt })
                await llm.start_game(prompt, manager.broadcast)
            elif input["type"] == "reset_game":
                await manager.broadcast({ "type": "reset" })
            else:
                choice = int(input["data"])
                await llm.continue_game_with_input(choice, manager.broadcast)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"Client {client_id} left the chat")


if __name__ == "__main__":
    # Launch the server
    # Uvicorn is a server programme that runs the 'app' object in 'main.py' (here)
    uvicorn.run("main:app", host=server_http_host, port=api_http_port)
