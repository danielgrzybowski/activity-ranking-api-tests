@locations @contract
Feature: Finding the city or town to plan around

  Every journey through this product starts with someone typing a place name.
  The API has to cope with half-typed input, with the many places that share
  a name, and with nothing matching at all - without ever making a typeahead
  throw an error at a user who is simply still typing.

  Background:
    The catalogue is deliberately not in population order, and its rows carry
    things Open-Meteo really does have: a place with no population, one with no
    region, and a heliport filed under its village's name. All three reach a
    picker, so all three are specified.

    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains:
      | id       | name     | region      | country        | countryCode | latitude | longitude | timezone            | population | featureCode |
      | 4517009  | London   | Ohio        | United States  | US          | 39.88645 | -83.44825 | America/New_York    | 10060      |             |
      | 11711303 | London Heliport |         | United Kingdom | GB          | 51.46993 | -0.17954  | Europe/London       |            | AIRH        |
      | 2643743  | London   | England     | United Kingdom | GB          | 51.50853 | -0.12574  | Europe/London       | 8961989    |             |
      | 982299   | London   | Mpumalanga  | South Africa   | ZA          | -24.76667 | 30.86667 | Africa/Johannesburg |            |             |
      | 6058560  | London   | Ontario     | Canada         | CA          | 42.98339 | -81.23304 | America/Toronto     | 346765     |             |
      | 2657896  | Zurich   | Canton of Zurich | Switzerland | CH          | 47.36667 | 8.55      | Europe/Zurich       | 341730     |             |
      | 2657928  | Zermatt  | Valais      | Switzerland    | CH          | 46.01998 | 7.74863   | Europe/Zurich       | 6629       |             |
      | 11862393 | Zermatt  | Valais      | Switzerland    | CH          | 46.02928 | 7.7533    | Europe/Zurich       |            | AIRH        |
      | 3027301  | Chamonix | Rhône-Alpes | France         | FR          | 45.92375 | 6.86933   | Europe/Paris        | 10614      |             |
      | 2265552  | Nazaré   | Leiria District | Portugal   | PT          | 39.60117 | -9.07048  | Europe/Lisbon       | 15158      |             |
      | 2368954  | Tombali  |             | Guinea-Bissau  | GW          | 11.3     | -15.41667 | Africa/Bissau       |            |             |

  @smoke
  Scenario: A partial name returns every candidate, most prominent first
    Open-Meteo hands its matches back in its own order, so putting the place
    most users mean at the top is the API's work, not the upstream's. Three
    real Londons exist: a picker showing "London" three times is a dead end,
    so the API - not the front end - owns the disambiguating label.

    When I search for locations matching "Lond"
    Then the response status is 200
    And the response matches the locations contract
    And the search results are, in order:
      | displayName                      |
      | London, England, United Kingdom  |
      | London, Ontario, Canada          |
      | London, Ohio, United States      |
      | London, Mpumalanga, South Africa |

  Scenario: A town with no population still reaches the picker, sorted last
    Open-Meteo has no population for thousands of small places. Sorting the
    unknowns to the top buries the London the user meant, and dropping them
    makes a real town unreachable, so they sort last and stay in.

    When I search for locations matching "Lond"
    Then the last result is "London, Mpumalanga, South Africa"
    And the result "London, Mpumalanga, South Africa" has no population

  Scenario: A town with no region gets a display name without an empty gap
    It has no region for plenty more, and "Tombali, , Guinea-Bissau" in a
    dropdown is a bug the user sees. The label is built from the parts that
    exist.

    When I search for locations matching "Tomb"
    Then the search results include "Tombali, Guinea-Bissau"
    And the result "Tombali, Guinea-Bissau" has no region

  Scenario: A place Open-Meteo has no country for still reaches the picker
    The third gap, after region and population, and the one the @live drift
    check found: id 11546715 is a London in Guadeloupe filed with a country
    code and no country name at all. The label falls back to the parts that do
    exist, and `countryCode` is still there for a flag.

    Given Open-Meteo's place catalogue contains:
      | id       | name   | region  | country        | countryCode | latitude | longitude | timezone           | population |
      | 2643743  | London | England | United Kingdom | GB          | 51.50853 | -0.12574  | Europe/London      | 8961989    |
      | 11546715 | London |         |                | GP          | 16.26487 | -61.48832 | America/Guadeloupe |            |
    When I search for locations matching "London"
    Then the response status is 200
    And the response matches the locations contract
    And the search returns 2 results
    And the search results include "London"
    And the result "London" has no country
    And every result has a distinct display name

  Scenario: An airfield does not use up one of the results the caller asked for
    `limit` is a number of towns, not a number of rows the upstream happened to
    send. Open-Meteo applies its own cap before we get to filter, so asking it
    for exactly two and then dropping the heliport hands a dropdown one
    suggestion, and hides a real town on a page nobody fetched.

    When I search for locations matching "Lond" with a limit of 2
    Then the response status is 200
    And the search returns 2 results
    And the search results are, in order:
      | displayName                     |
      | London, England, United Kingdom |
      | London, Ontario, Canada         |

  Scenario: Two towns with the same name, region and country are still told apart
    "Name, Region, Country" separates three Londons in three countries. It does
    not separate the four pairs that share a US state - two in Ohio, two in
    Texas, two in Alabama, two in Minnesota - and two identical rows are the
    same dead end one level down. Only the colliding rows grow a county; the
    rest stay short.

    Given Open-Meteo's place catalogue contains:
      | id      | name   | subregion | region | country       | countryCode | latitude | longitude | timezone         | population |
      | 4517009 | London | Madison   | Ohio   | United States | US          | 39.88645 | -83.44825 | America/New_York | 10060      |
      | 5161176 | London | Richland  | Ohio   | United States | US          | 40.91033 | -82.62934 | America/New_York |            |
    When I search for locations matching "London"
    Then the response status is 200
    And the search returns 2 results
    And every result has a distinct display name
    And the search results include "London, Madison, Ohio, United States"

  Scenario: An airfield sharing a town's name is not offered as a place to visit
    Open-Meteo's catalogue is not a list of towns: it carries airports and
    heliports filed under their village's name, with the same region and the
    same country. Two rows both reading "Zermatt, Valais, Switzerland" are a
    picker asking the user to choose between two identical options - and one of
    them is a landing pad. "City or town name" means the town.

    When I search for locations matching "Zermatt"
    Then the response status is 200
    And the search returns 1 result
    And the search results include "Zermatt, Valais, Switzerland"
    And every result has a distinct display name

  Scenario Outline: Search ignores case and accents
    When I search for locations matching "<query>"
    Then the response status is 200
    And the search results include "<displayName>"

    Examples:
      | query  | displayName                         |
      | zürich | Zurich, Canton of Zurich, Switzerland |
      | zurich | Zurich, Canton of Zurich, Switzerland |
      | nazare | Nazaré, Leiria District, Portugal    |
      | LoNdOn | London, England, United Kingdom     |

  Scenario: A place nobody has heard of returns an empty list, not an error
    A typeahead that 404s would flash an error on every unfinished word.

    When I search for locations matching "Qwertyville"
    Then the response status is 200
    And the response matches the locations contract
    And the search returns 0 results
    And the response body carries no error

  Scenario: The echoed query lets the front end discard stale responses
    A typeahead fires a request per keystroke and they come back out of order.

    When I search for locations matching "Lond" with a limit of 2
    Then the search returns 2 results
    And the echoed query is "Lond"

  Scenario Outline: Input that is not worth a lookup is rejected, not guessed at
    When I search for locations matching "<query>"
    Then the response status is 400
    And the error code is "INVALID_QUERY"
    And the error message explains the minimum query length

    Examples:
      | query |
      |       |
      | L     |

  # This cannot join the Examples table above: Gherkin trims table cells, so a
  # whitespace query is unwritable as a row.
  Scenario: A query of only whitespace is rejected like an empty one
    Trimmed before it is measured.

    When I search for locations matching "   "
    Then the response status is 400
    And the error code is "INVALID_QUERY"

  Scenario: Two characters is enough to search on
    The boundary from the other side. Every rejection above is satisfied by an
    implementation reading the rule as "more than two", which would quietly
    refuse the shortest legitimate search.

    When I search for locations matching "Lo"
    Then the response status is 200
    And the search returns at least 1 result

  Scenario: A missing query parameter is rejected like an empty one
    An absent parameter is not a special case worth an error code of its own.

    When I request locations with no query parameter
    Then the response status is 400
    And the error code is "INVALID_QUERY"

  Scenario Outline: A nonsensical limit is rejected rather than silently clamped
    When I search for locations matching "Lond" with a limit of "<limit>"
    Then the response status is 400
    And the error code is "INVALID_QUERY"

    Examples: The two paths that can reject it - out of range, and not a number
      | limit |
      | 0     |
      | many  |

  Scenario: The typeahead is cheap, cacheable and callable from a browser
    Called from the same browser page as the rankings, so it needs the same
    headers. Forecast calls cost quota, and searching is not forecasting.

    Given the request comes from the origin "https://app.example.test"
    When I search for locations matching "Lond"
    Then the response allows that origin
    And the response may be cached for at least 60 seconds
    And a shared cache cannot hand this response to a different origin
    And Open-Meteo's forecast service was not called
    And the response arrived within the "locations" latency budget
