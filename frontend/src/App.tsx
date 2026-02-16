import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";


type Loc = "outside" | "inside";

type Data = {
  type: string;
  data: any;
};

// Figure out what our location is
const params = new URLSearchParams(document.location.search);
const loc = params.get("loc") as Loc;


// Download file method
const downloadFile = (uriComponent: string | number | boolean, fileName: string) => {
	const data = "data:text/json;charset=utf-8," + encodeURIComponent(uriComponent);
	const downloadAnchor = document.createElement("a");
	downloadAnchor.setAttribute("href", data);
	downloadAnchor.setAttribute("download", fileName + ".json");
	document.body.appendChild(downloadAnchor);
	downloadAnchor.click();
	downloadAnchor.remove();
};


const App = () => {
  const [showWelcome, setShowWelcome] = useState(true);
  const [waitingForQuery, setWaitingForQuery] = useState(true);
  const [gameFinished, setGameFinished] = useState(false);

  const [botResponse, setBotResponse] = useState("");
  const addToBotResponse = (token: string) => setBotResponse(response => response + token);

  const prevToken = useRef("");

  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    ws.current = new WebSocket(`ws://127.0.0.1:5000/ws/${loc}`);
    // ws.current = new WebSocket(`wss://dashing-treefrog-actively.ngrok-free.app/ws/${loc}`);

    return () => {
      ws.current?.close();
    }
  }, []);

  useEffect(() => {
    if (!ws.current) return;
    ws.current.onmessage = event => {
      const data = JSON.parse(event.data) as Data;

      if(data.type === "prompt") {
        setWaitingForQuery(false);
        if (loc === "inside") {
          // Reset the query banner at the top of the page
          const queryLabel = document.getElementById("userQueryLabel")!;
          queryLabel.innerText = "User Query: ";
          const query = document.getElementById("userQuery")!;
          query.innerText = data.data;
        }
      }
      else if(data.type === "reset") {
        // Reset the entire game
        setBotResponse("");
        setGameFinished(false);
        setWaitingForQuery(true);
        setUserQuery("");
        setShowWelcome(true);
        if (loc === "inside") {
          const queryLabel = document.getElementById("userQueryLabel")!;
          queryLabel.innerText = "Waiting for user query...";
          const query = document.getElementById("userQuery")!;
          query.innerText = "";
        }
      }
      else if(data.type === "next_token") {
        // Add the next token to the response
        const token = data.data as string;

        if (token === "<|eot_id|>") {
          addToBotResponse("\n\n");
        }
        else if (
          token === "<|start_header_id|>" ||
          token === "<|end_header_id|>" ||
          (prevToken.current === "<|start_header_id|>" && token === "assistant")
        ) { /* Ignore these tokens and don't print anything */ }
        else {
          for (const char of token) {
            // Doesn't work but would be nice if it were to actually stream character by character
            // Currently this just displays word by word due to React state batching
            addToBotResponse(char);
          }
        }

        prevToken.current = token;
      }
      else if(data.type === "inside_choice") {
        // Update the interface to let the user choose
        if (loc === "inside") {
          for (let i = 0; i < 5; i++){
            const button = document.getElementById(`opt-${i}`) as HTMLButtonElement | undefined;
            if (!button) continue;
            let content = data.data[i].token;
            content += "<br></br>";
            content += Math.floor(data.data[i].prob * 100) + "%";
            button.innerHTML = content;
            button.disabled = false;
            button.onclick = () => choiceSelect(i + 1);
          }
        }
      }
      else if(data.type === "finish") {
        setGameFinished(true);
      }
    };
  });

  // Handle outside
  const [userQuery, setUserQuery] = useState("");
  const handleUserQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => setUserQuery(event.target.value);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = document.getElementById("ask-input")! as HTMLInputElement;
    ws.current?.send(JSON.stringify({ type: "start_game", data: input.value}));
  };

  const restartGame = () => {
    if (confirm("Would you like to save this conversation?")) {
      // Save the conversation
      downloadFile(JSON.stringify({ date: Date.now(), prompt: userQuery, response: botResponse }), (new Date()).toISOString());
    }
    ws.current?.send(JSON.stringify({ type: "reset_game" }));
  };

  // Handle inside
  const choiceSelect = (choice: number) => {
    ws.current?.send(JSON.stringify({ type: "choice", data: choice }));
    // Empty the buttons
    for (let i = 0; i < 5; i++) {
      const button = document.getElementById(`opt-${i}`) as HTMLButtonElement | undefined;
      if (!button) continue;
      button.innerHTML = "";
      button.disabled = true;
    }
  };


  // Render the interface
  return loc === "outside" ? (<>
    <div className={`w-screen h-screen flex flex-col items-center justify-center bg-[url("/editomorrow.webp")] bg-center bg-cover bg-no-repeat bg-white/30 bg-blend-lighten`}>
      <img 
        src="./edinbot.webp"
        alt="Edinbot logo"
        className="w-[16.5rem] -mb-6 drop-shadow-[0_0_32px_white]"
      />
      <div className="w-[70%] flex flex-col border border-white/80 backdrop-blur-3xl rounded-lg shadow-[4px_4px_32px_#bebebe,-4px_-4px_32px_#ffffff] overflow-hidden">
        <div className={`bg-white/70 ${waitingForQuery ? "hover:bg-white/90 focus-within:bg-white/90" : ""} transition-colors`}>
          {/* User input */}
          <form
            onSubmit={handleSubmit}
            className="flex"
          >
            <input
              id="ask-input"
              type="text"
              value={userQuery}
              placeholder="Ask me about Edinburgh!"
              onChange={handleUserQueryChange}
              readOnly={!waitingForQuery}
              autoComplete="off"
              className={`grow p-6 text-xl placeholder:text-gray-600 bg-transparent focus:outline-none ${waitingForQuery ? "rounded-l-lg" : "rounded-lg"}`}
            />
            {
              waitingForQuery &&
              <button
                type="submit"
                className="p-6 bg-blue-950 hover:bg-blue-800 text-white font-bold text-xl"
              >
                ASK
              </button>
            }
          </form>
          {/* Model output */}
          { !waitingForQuery &&
            <div className="flex p-6 border-t border-white/80">
              { !gameFinished &&
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" className="inline-block shrink-0 mt-px mr-4 animate-spin" viewBox="0 0 16 16">
                  <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
                </svg>
              }
              <div className="max-h-[250px] flex flex-col-reverse overflow-y-auto">
                <Markdown className="text-xl">
                  { botResponse }
                </Markdown>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
    { gameFinished &&
        <button
          className="absolute top-6 right-6 border border-white/80 backdrop-blur-3xl rounded-full shadow-[4px_4px_32px_#bebebe,-4px_-4px_32px_#ffffff] active:shadow-[2px_2px_16px_#bebebe,-2px_-2px_16px_#ffffff] overflow-hidden transition-shadow"
          onClick={restartGame}
        >
          <div className="bg-white/70 p-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" className="fill-blue-950" viewBox="0 0 16 16">
              <path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
              <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/>
            </svg>
          </div>
        </button>
      }
  </>) : (
    <div>
      {/* Welcome screen */}
      { showWelcome &&
        <div className="absolute position-center flex flex-col justify-around p-8 text-center z-10 w-[90vw] h-[90vh] mx-[5vw] my-[5vh] bg-[black] rounded-lg border-solid border-[#84cc16] border-2 text-[#65a30d] shadow-[0px_0px_30px_#65a30d]">
          <h2 className="font-bold text-2xl">
            Welcome!
          </h2>
          <p className="text-xl">
            Text generators respond to prompts by predicting the most likely next token, building replies one word at a time. A bit of randomness, like choosing (sampling) from the top 5 words instead of the most likely one, keeps their answers interesting but also makes them less reliable.
          </p>
          <p className="text-xl">
            Today, <span className="underline">you</span> get to be that random factor. See how much your choices steer the output, and decide exactly how helpful you want EdinBot to be!
          </p>
          <button
            className="w-fit mx-auto p-6 bg-[#84cc16] hover:bg-[#a3e635] active:bg-[#4d7c0f] rounded font-bold text-[black] text-xl uppercase"
            onClick={() => setShowWelcome(false)}
          >
            Get started
          </button>
        </div>
      }
      {/* Inside interface */}
      <div className="flex flex-col items-center justify-between h-screen px-4 py-12 bg-[black] text-[#65a30d]">
        <div className="flex flex-row justify-start margin-20 mb-4 text-lg font-bold border-solid border-[#84cc16] border-2 p-2 shadow-[4px_4px_0px_#65a30d]">
          <h1 id="userQueryLabel" className="mr-2">Waiting for user query...</h1>
          <h2 id="userQuery"></h2>
        </div>
        { !waitingForQuery && <>
          <div className="flex flex-col items-center justify-center w-full max-w-[1100px]">
            <h1 className="font-bold">Your response:</h1>
            <p className="w-3/4 max-w-[1100px] max-h-[250px] p-4 flex flex-col-reverse border-2 border-[#84cc16] rounded-md overflow-y-auto">
              { botResponse }
              { !gameFinished &&
                "..."
              }
            </p>
            { !gameFinished && <>
              <img className="w-full px-[9.5%]" src="connectors.svg" alt="Decorative connector lines" />
              <div id="choices" className="w-full h-[116px] grid grid-cols-5 justify-items-center text-center text-lg">
                { [0, 1, 2, 3, 4].map(no => (
                  <button key={no} id={`opt-${no}`} className="h-fit cursor-pointer rounded-lg shadow-[0px_0px_20px_#65a30d] hover:font-bold m-2 p-2" disabled></button>
                ))}
              </div>
            </>}
          </div>
        </>}
        <h3 className="font-bold">
          { gameFinished ?
            "Response complete. Thanks for playing!"
          :
            "Select the next word to continue the response"
          }
        </h3>
      </div>
    </div>
  );
};

export default App;
