@rankings @contract
Feature: The shape of a seven-day activity ranking

  Once a place is chosen the user gets one screen: seven days, four
  activities per day, each with a suitability and a plain-English reason.
  These scenarios pin down what that screen can rely on, independently of
  what the weather happens to be.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities
    And every day of the forecast for "Chamonix" is "MILD_OVERCAST_DAY"

  @smoke
  Scenario: A ranking covers seven days and all four activities
    When I request rankings for location id "3027301"
    Then the response status is 200
    And the response matches the rankings contract
    And the ranking covers 7 consecutive days starting from the first forecast day
    And every day ranks all four activities:
      | SKIING              |
      | SURFING             |
      | OUTDOOR_SIGHTSEEING |
      | INDOOR_SIGHTSEEING  |
    And every entry carries a date, an activity name, a suitability and a reason
    And every reasoning is at most 160 characters
    And every reasoning gives a reason the user can act on

  Scenario: Ranks run 1 to 4, by score, with ties broken alphabetically
    Without a stated tie-break, two equally-good activities would swap places
    between refreshes and the list would look unstable to the user.

    When I request rankings for location id "3027301"
    Then every day numbers its activities 1 to 4 with no gaps or duplicates
    And within each day a better score never has a worse rank
    And activities tied on score are ordered alphabetically
    And every rating matches the documented band for its score

  Scenario: Sightseeing is never ruled out by the location
    Only surfing and skiing can be ruled out by geography. Sightseeing asks
    nothing of the place: every town has streets, and somewhere to shelter.

    When I request rankings for location id "3027301"
    Then "OUTDOOR_SIGHTSEEING" is scored on the weather, not ruled out by the location
    And "INDOOR_SIGHTSEEING" is scored on the weather, not ruled out by the location

  Scenario: The response says what it ranked, in what timezone, in what units
    Everything the screen needs to render a header the user can trust: which
    place we actually ranked, where the numbers came from, and what they mean.

    When I request rankings for location id "3027301"
    Then the resolved location is "Chamonix, Rhône-Alpes, France"
    And the resolved location id is "3027301"
    And the forecast source is "open-meteo"
    And the forecast timezone is "Europe/Paris"
    And the response declares units for temperature, precipitation, snowfall and wind speed

  Scenario Outline: A shorter window can be requested
    When I request rankings for location id "3027301" over <days> days
    Then the response status is 200
    And the response matches the rankings contract
    And the ranking covers <days> consecutive days starting from the first forecast day

    Examples: The two ends of the range
      | days |
      | 1    |
      | 7    |

  Scenario Outline: A day count outside the supported window is rejected
    When I request rankings for location id "3027301" over "<days>" days
    Then the response status is 400
    And the error code is "INVALID_DAYS"

    Examples:
      | days |
      | 0    |
      | 8    |
      | week |

  Scenario: The same request twice gives the same answer
    The same forecast must produce the same ranking, or nothing downstream
    (caching, screenshots, a user comparing two tabs) can be trusted.

    When I request rankings for location id "3027301"
    And I request rankings for location id "3027301" again
    Then both responses are identical apart from the generation timestamp

  # Asserted with an Origin header, because that is the only request a browser
  # ever makes: a server that only emits CORS headers when asked would pass a
  # bare GET and still break the front end.
  Scenario: The response is cacheable and usable from a browser front end
    Given the request comes from the origin "https://app.example.test"
    When I request rankings for location id "3027301"
    Then the response status is 200
    And the response allows that origin
    And the response may be cached for at least 60 seconds
    And a shared cache cannot hand this response to a different origin
    And the "content-type" header contains "application/json"

  @performance
  Scenario: Rankings arrive inside the spinner budget
    When I request rankings for location id "3027301"
    Then the response status is 200
    And the response arrived within the "rankings" latency budget
