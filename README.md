# Become the Homework Bot

Code for 'Become the Homework Bot' workshops. Continuation of the 'Stepping Into the Black Box' project by Sarah Immel, Neel Rajani, and me (Rayo Verweij).

## Setup

- In server, install dependencies with uv

- In frontend, install dependencies with npm

- Run ngrok with `ngrok start --all --config ngrok.yml` from `frontend`

- Run both server and frontend separately from their folders

- Update `allowedHosts` in `vite.config.ts` if necessary

## Notes

Loading weights:

- 7B: ~1 min 30
- 32B: ~5 min 30

## Known issues

- Tokenizer decode does not support decoding emoji?
