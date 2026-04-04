"""
FastAPI server for AgentX bot model.
Provides OpenAI-compatible API for the fine-tuned model.
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
import os

app = FastAPI(title="AgentX Bot API")

# Model would be loaded here in production
# For now, just a placeholder API

@app.get("/")
async def root():
    return {"status": "AgentX Bot API", "version": "1.0"}

@app.get("/v1/models")
async def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": "agentx-bot",
                "object": "model",
                "created": 1700000000,
                "owned_by": "agentx"
            }
        ]
    }

@app.post("/v1/chat/completions")
async def chat_completions(request: dict):
    model = request.get("model", "agentx-bot")
    messages = request.get("messages", [])
    
    if not messages:
        raise HTTPException(status_code=400, detail="No messages provided")
    
    # In production, this would call the fine-tuned model
    # For now, return a placeholder response
    
    last_message = messages[-1].get("content", "")
    
    return {
        "id": f"chatcmpl-{os.urandom(8).hex()}",
        "object": "chat.completion",
        "created": 1700000000,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": f"I'm AgentX bot. I'd help with: {last_message[:50]}..."
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 10,
            "total_tokens": 20
        }
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)