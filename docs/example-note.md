# Secret Lens Demo

This is ordinary note text. Inline secrets can appear after it:

The demo API key is `secret(DEMO_API_KEY)` and the region is `secret(DEMO_REGION)`.

For a larger, more visible secret panel:

```secret
${{DEMO_API_KEY}}
```

You can also display a complete connection string:

```secret
https://demo-user:${{DEMO_PASSWORD}}@api.example.test/v1
```

The source remains readable while the rendered view shows the resolved values.
