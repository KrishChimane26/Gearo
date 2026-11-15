# GEARO: free public website

Free stack: Vercel (hosting) + Google Gemini API free tier (answers) + Tavily free plan (live web search).

1. Gemini key: aistudio.google.com > Get API key > Create key. No card needed.
2. Tavily key: app.tavily.com > sign up > copy the API key. No card needed.
3. Upload this folder to a new GitHub repository.
4. vercel.com > sign in with GitHub > Add New > Project > import the repository.
5. Add environment variables: GEMINI_API_KEY and TAVILY_API_KEY. Deploy.
6. Open the link Vercel gives you and test with: "What is the latest news today?"

Optional: GEMINI_MODEL to use another Gemini model (default gemini-3.8-flash).
