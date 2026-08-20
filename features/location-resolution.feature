@rankings @errors @contract
Feature: Turning what the user typed into the place we rank

  A ranking request can name a place two ways: the id the user picked from
  the search results, or the raw city name they typed. The id is exact. The
  name is not, and the API has to be honest about that rather than guessing
  and quietly ranking the wrong continent.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities
    And every day of the forecast for "Paris" is a "PERFECT_SUMMER_DAY"

  @smoke
  Scenario: A location id picked from search results ranks that exact place
    When I request rankings for location id "2988507"
    Then the response status is 200
    And the resolved location id is "2988507"
    And the resolved location is "Paris, Ile-de-France, France"

  Scenario: An unambiguous city name works without a search round trip
    When I request rankings for the city "Paris"
    Then the response status is 200
    And the resolved location is "Paris, Ile-de-France, France"

  Scenario: City names are matched without regard to case or accents
    When I request rankings for the city "zurich"
    Then the response status is 200
    And the resolved location is "Zürich, Zurich, Switzerland"

  # Silently picking the biggest London would eventually rank Ontario's
  # weather for someone standing in England. The API asks instead.
  Scenario: An ambiguous city name asks the user to choose
    When I request rankings for the city "London"
    Then the response status is 409
    And the error code is "AMBIGUOUS_LOCATION"
    And the error details list the candidate locations
    And each candidate carries the location id needed to retry

  Scenario: A city nobody has heard of is a clear not-found
    When I request rankings for the city "Qwertyville"
    Then the response status is 404
    And the error code is "LOCATION_NOT_FOUND"
    And the error message mentions "Qwertyville"

  Scenario: An unknown location id is a clear not-found
    When I request rankings for location id "99999999"
    Then the response status is 404
    And the error code is "LOCATION_NOT_FOUND"

  Scenario: Asking for nowhere in particular is rejected
    When I request rankings with no location
    Then the response status is 400
    And the error code is "MISSING_LOCATION"

  # Both parameters means the client is confused. Picking one for it would
  # hide a bug in the front end.
  Scenario: Supplying both a city and a location id is rejected
    When I request rankings for location id "2988507" and the city "London"
    Then the response status is 400
    And the error code is "CONFLICTING_LOCATION_PARAMS"

  Scenario Outline: A city name that could not be a place is rejected
    When I request rankings for the city "<city>"
    Then the response status is 400
    And the error code is "INVALID_QUERY"

    Examples:
      | city |
      |      |
      | P    |

  Scenario: Errors are shaped consistently so one handler can render them all
    When I request rankings for the city "Qwertyville"
    Then the response matches the error contract
    And the "content-type" header contains "application/json"

  # Injection-shaped input should come back as a plain not-found, not a 500.
  Scenario Outline: Hostile-looking input is handled, not crashed on
    When I request rankings for the city "<city>"
    Then the response status is one of "400, 404"
    And the response matches the error contract

    Examples:
      | city                     |
      | <script>alert(1)</script> |
      | ' OR 1=1 --              |
      | ../../etc/passwd         |
      | %00                      |
